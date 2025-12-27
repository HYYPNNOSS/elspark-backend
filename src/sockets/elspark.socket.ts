import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { ElsparkService } from "../services/elspark.service";

const prisma = new PrismaClient();
const elsparkService = new ElsparkService();

interface VideoQueueItem {
  id: string;
  videoId: string;
  position: number;
  status: 'waiting' | 'playing' | 'played';
  video: {
    id: string;
    title: string;
    url: string;
    duration: number;
    uploaderId: number;
    uploader?: {
      id: number;
      username: string;
      profilePicture: string | null;
    };
  };
}

interface CurrentVideoState {
  video: VideoQueueItem | null;
  currentTime: number;
  isPlaying: boolean;
  startedAt: number;
}

let currentVideoState: CurrentVideoState = {
  video: null,
  currentTime: 0,
  isPlaying: false,
  startedAt: 0
};

let videoSyncInterval: NodeJS.Timeout | null = null;
const activeElsparkUsers = new Map<number, string>();
const recentChatMessages: any[] = [];

export function setupElsparkWebSocket(io: Server) {
  const elsparkNamespace = io.of('/elspark-tv');

  startVideoSyncBroadcast(elsparkNamespace);

  elsparkNamespace.on('connection', async (socket: Socket) => {
    console.log('ElSpark TV client connected:', socket.id);

    socket.join('live-tv-main');
    socket.join('live-chat');

    socket.on('user:join', async (data: { profileId: number }) => {
      try {
        const { profileId } = data;
        
        activeElsparkUsers.set(profileId, socket.id);
        socket.join(`user:${profileId}`);

        const profile = await prisma.profile.findUnique({
          where: { id: profileId },
          include: { account: true }
        });

        if (!profile) {
          socket.emit('error', { message: 'Profile not found' });
          return;
        }

        const queue = await elsparkService.getQueue();
        const currentVideo = await elsparkService.getCurrentVideo();
        
        socket.emit('initial:state', {
          currentVideo: currentVideoState,
          queue,
          recentMessages: recentChatMessages.slice(-50),
          coinBalance: profile.account.cyberCoins.toNumber(),
          userProfile: {
            id: profile.id,
            username: profile.username,
            profilePicture: profile.profilePicture
          }
        });

        // Check if we need to start playback (for late joiners)
        setTimeout(() => checkAndStartPlayback(elsparkNamespace), 500);
        
        elsparkNamespace.to('live-chat').emit('chat:user_joined', {
          username: profile.username,
          profileId: profile.id,
          timestamp: new Date().toISOString()
        });

        console.log(`User ${profile.username} joined ElSpark TV`);
      } catch (error) {
        console.error('Error handling user join:', error);
        socket.emit('error', { message: 'Failed to join' });
      }
    });

    socket.on('chat:send_message', async (data: { profileId: number; message: string }) => {
      try {
        const { profileId, message } = data;

        if (!message || message.trim().length === 0) {
          return;
        }

        const profile = await prisma.profile.findUnique({
          where: { id: profileId },
          select: { id: true, username: true, profilePicture: true }
        });

        if (!profile) {
          socket.emit('error', { message: 'Profile not found' });
          return;
        }

        const chatMessage = {
          id: Date.now().toString(),
          profileId: profile.id,
          username: profile.username,
          profilePicture: profile.profilePicture,
          message: message.trim(),
          timestamp: new Date().toISOString()
        };

        recentChatMessages.push(chatMessage);
        if (recentChatMessages.length > 50) {
          recentChatMessages.shift();
        }

        elsparkNamespace.to('live-chat').emit('chat:message', chatMessage);
      } catch (error) {
        console.error('Error sending chat message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('video:ended', async () => {
      try {
        await playNextVideo(elsparkNamespace);
      } catch (error) {
        console.error('Error playing next video:', error);
      }
    });

    socket.on('video:skip', async (data: { profileId: number }) => {
      try {
        await playNextVideo(elsparkNamespace);
      } catch (error) {
        console.error('Error skipping video:', error);
      }
    });

    socket.on('video:pause', async () => {
      currentVideoState.isPlaying = false;
      elsparkNamespace.to('live-tv-main').emit('video:paused', {
        currentTime: currentVideoState.currentTime
      });
    });

    socket.on('video:resume', async () => {
      currentVideoState.isPlaying = true;
      currentVideoState.startedAt = Date.now() - (currentVideoState.currentTime * 1000);
      elsparkNamespace.to('live-tv-main').emit('video:resumed', {
        currentTime: currentVideoState.currentTime
      });
    });

    socket.on('user:leave', async (data: { profileId: number }) => {
      try {
        const { profileId } = data;
        activeElsparkUsers.delete(profileId);

        const profile = await prisma.profile.findUnique({
          where: { id: profileId },
          select: { username: true }
        });

        if (profile) {
          elsparkNamespace.to('live-chat').emit('chat:user_left', {
            username: profile.username,
            profileId,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('Error handling user leave:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('ElSpark TV client disconnected:', socket.id);
      
      for (const [profileId, socketId] of activeElsparkUsers.entries()) {
        if (socketId === socket.id) {
          activeElsparkUsers.delete(profileId);
          break;
        }
      }
    });
  });

  loadInitialVideo(elsparkNamespace);
}

// CRITICAL FIX: Added retry logic with exponential backoff
export async function playNextVideo(namespace: any, retryCount = 0): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 200; // Start with 200ms
  
  try {
    console.log(`[PLAY NEXT] Attempt ${retryCount + 1}/${MAX_RETRIES + 1}`);
    
    // Mark current video as played
    if (currentVideoState.video) {
      console.log('[PLAY NEXT] Marking current video as played:', currentVideoState.video.video.title);
      await prisma.liveTVQueue.update({
        where: { id: currentVideoState.video.id },
        data: { 
          status: 'played',
          endTime: new Date()
        }
      });
      
      // Wait for DB to commit
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Get next video with fresh query
    const nextVideo = await prisma.liveTVQueue.findFirst({
      where: { status: 'waiting' },
      orderBy: { position: 'asc' },
      include: {
        video: {
          include: {
            uploader: {
              select: {
                id: true,
                username: true,
                profilePicture: true
              }
            }
          }
        }
      }
    });

    console.log('[PLAY NEXT] Found next video:', nextVideo ? nextVideo.video.title : 'none');

    if (nextVideo) {
      // Update queue item status
      await prisma.liveTVQueue.update({
        where: { id: nextVideo.id },
        data: { 
          status: 'playing',
          startTime: new Date()
        }
      });

      // Update current state
      currentVideoState = {
        video: {
          id: nextVideo.id,
          videoId: nextVideo.videoId,
          position: nextVideo.position,
          status: 'playing',
          video: {
            id: nextVideo.video.id,
            title: nextVideo.video.title,
            url: nextVideo.video.url,
            duration: nextVideo.video.duration,
            uploaderId: nextVideo.video.uploaderId,
            uploader: nextVideo.video.uploader
          }
        },
        currentTime: 0,
        isPlaying: true,
        startedAt: Date.now()
      };

      console.log('[PLAY NEXT] Broadcasting video:started event for:', nextVideo.video.title);

      // Broadcast video started
      namespace.to('live-tv-main').emit('video:started', {
        video: currentVideoState.video,
        timestamp: new Date().toISOString()
      });

      // Broadcast queue update
      const updatedQueue = await elsparkService.getQueue();
      namespace.to('live-tv-main').emit('video:queue_update', {
        queue: updatedQueue
      });
      
      console.log('[PLAY NEXT] Successfully started video:', nextVideo.video.title);
      return true;
    } else if (retryCount < MAX_RETRIES) {
      // Retry with exponential backoff
      const delay = RETRY_DELAY * Math.pow(2, retryCount);
      console.log(`[PLAY NEXT] No video found, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return playNextVideo(namespace, retryCount + 1);
    } else {
      // No videos in queue after retries
      console.log('[PLAY NEXT] No videos in queue after retries, emitting queue_empty');
      currentVideoState = {
        video: null,
        currentTime: 0,
        isPlaying: false,
        startedAt: 0
      };

      namespace.to('live-tv-main').emit('video:queue_empty');
      return false;
    }
  } catch (error) {
    console.error('[PLAY NEXT ERROR]:', error);
    
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY * Math.pow(2, retryCount);
      console.log(`[PLAY NEXT] Error occurred, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return playNextVideo(namespace, retryCount + 1);
    }
    
    return false;
  }
}

async function loadInitialVideo(namespace: any) {
  try {
    const playingVideo = await prisma.liveTVQueue.findFirst({
      where: { status: 'playing' },
      include: {
        video: {
          include: {
            uploader: {
              select: {
                id: true,
                username: true,
                profilePicture: true
              }
            }
          }
        }
      }
    });

    if (playingVideo) {
      currentVideoState = {
        video: {
          id: playingVideo.id,
          videoId: playingVideo.videoId,
          position: playingVideo.position,
          status: 'playing',
          video: {
            id: playingVideo.video.id,
            title: playingVideo.video.title,
            url: playingVideo.video.url,
            duration: playingVideo.video.duration,
            uploaderId: playingVideo.video.uploaderId,
            uploader: playingVideo.video.uploader
          }
        },
        currentTime: 0,
        isPlaying: true,
        startedAt: Date.now()
      };
      console.log('Resumed existing playing video:', playingVideo.video.title);
    } else {
      console.log('No playing video found, attempting to play next video');
      await playNextVideo(namespace);
    }
  } catch (error) {
    console.error('Error loading initial video:', error);
  }
}

function startVideoSyncBroadcast(namespace: any) {
  if (videoSyncInterval) {
    clearInterval(videoSyncInterval);
  }

  videoSyncInterval = setInterval(() => {
    if (currentVideoState.video && currentVideoState.isPlaying) {
      const elapsed = (Date.now() - currentVideoState.startedAt) / 1000;
      currentVideoState.currentTime = elapsed;

      namespace.to('live-tv-main').emit('video:current', {
        video: currentVideoState.video,
        currentTime: currentVideoState.currentTime,
        isPlaying: currentVideoState.isPlaying,
        serverTime: Date.now()
      });

      if (currentVideoState.currentTime >= currentVideoState.video.video.duration) {
        playNextVideo(namespace);
      }
    }
  }, 5000);
}

// IMPROVED: More robust playback check with database polling
export async function checkAndStartPlayback(namespace: any, retryCount = 0): Promise<boolean> {
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 300;
  
  try {
    console.log(`[PLAYBACK CHECK] Attempt ${retryCount + 1}/${MAX_RETRIES + 1}`);
    
    // Force fresh query with timeout
    const [current, queue] = await Promise.all([
      prisma.liveTVQueue.findFirst({
        where: { status: 'playing' },
        include: {
          video: {
            include: {
              uploader: {
                select: {
                  id: true,
                  username: true,
                  profilePicture: true
                }
              }
            }
          }
        }
      }),
      prisma.liveTVQueue.findMany({
        where: { status: 'waiting' },
        orderBy: { position: 'asc' },
        take: 5, // Only check first 5
        include: {
          video: {
            include: {
              uploader: {
                select: {
                  id: true,
                  username: true,
                  profilePicture: true
                }
              }
            }
          }
        }
      })
    ]);
    
    console.log('[PLAYBACK CHECK]', { 
      hasCurrentVideo: !!current, 
      queueLength: queue.length,
      currentVideoState: currentVideoState.video ? 'has video' : 'empty',
      currentVideoPlaying: currentVideoState.isPlaying,
      queueFirstItem: queue[0]?.video?.title || 'none',
      attempt: retryCount + 1
    });
    
    // Check if nothing is playing AND queue has videos
    if (!current && queue.length > 0 && !currentVideoState.isPlaying) {
      console.log('[PLAYBACK] Starting playback - queue has videos but nothing playing');
      return await playNextVideo(namespace);
    }
    
    // Retry if we expect a video but don't see it yet
    if (!current && !currentVideoState.isPlaying && retryCount < MAX_RETRIES) {
      console.log(`[PLAYBACK] Retrying in ${RETRY_DELAY}ms... (video might still be committing)`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return checkAndStartPlayback(namespace, retryCount + 1);
    }
    
    console.log('[PLAYBACK] No action needed');
    return false;
  } catch (error) {
    console.error('[PLAYBACK CHECK ERROR]:', error);
    
    if (retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return checkAndStartPlayback(namespace, retryCount + 1);
    }
    
    return false;
  }
}

export function emitToUser(profileId: number, event: string, data: any, io: Server) {
  const namespace = io.of('/elspark-tv');
  namespace.to(`user:${profileId}`).emit(event, data);
}

export async function broadcastQueueUpdate(io: Server) {
  const namespace = io.of('/elspark-tv');
  const queue = await elsparkService.getQueue();
  namespace.to('live-tv-main').emit('video:queue_update', { queue });
}

export function emitCoinUpdate(profileId: number, newBalance: number, io: Server) {
  emitToUser(profileId, 'user:coin_update', { balance: newBalance }, io);
}

export function emitCollectionUpdate(profileId: number, io: Server) {
  emitToUser(profileId, 'collection:updated', { timestamp: Date.now() }, io);
}