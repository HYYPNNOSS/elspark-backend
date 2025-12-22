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
    uploader?: {  // ADD THIS
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
const activeElsparkUsers = new Map<number, string>(); // profileId -> socketId
const recentChatMessages: any[] = []; // Store last 50 messages

export function setupElsparkWebSocket(io: Server) {
  const elsparkNamespace = io.of('/elspark-tv');

  // Start video sync broadcaster
  startVideoSyncBroadcast(elsparkNamespace);

  elsparkNamespace.on('connection', async (socket: Socket) => {
    console.log('ElSpark TV client connected:', socket.id);

    // Join main rooms
    socket.join('live-tv-main');
    socket.join('live-chat');

    socket.on('user:join', async (data: { profileId: number }) => {
      try {
        const { profileId } = data;
        
        // Track user
        activeElsparkUsers.set(profileId, socket.id);
        socket.join(`user:${profileId}`);

        // Get user profile with account
        const profile = await prisma.profile.findUnique({
          where: { id: profileId },
          include: { account: true }
        });

        if (!profile) {
          socket.emit('error', { message: 'Profile not found' });
          return;
        }

        // Send initial state to the new user
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

        setImmediate(async () => {
          await checkAndStartPlayback(elsparkNamespace);
        });
        
        // Broadcast user joined to chat
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

    // Chat message handler
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

        // Store in memory (last 50)
        recentChatMessages.push(chatMessage);
        if (recentChatMessages.length > 50) {
          recentChatMessages.shift();
        }

        // Broadcast to all users in chat
        elsparkNamespace.to('live-chat').emit('chat:message', chatMessage);
      } catch (error) {
        console.error('Error sending chat message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Video ended - play next
    socket.on('video:ended', async () => {
      try {
        await playNextVideo(elsparkNamespace);
      } catch (error) {
        console.error('Error playing next video:', error);
      }
    });

    // Admin controls
    socket.on('video:skip', async (data: { profileId: number }) => {
      try {
        // TODO: Add admin check here
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

    // User leaves
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

    // Disconnect handler
    socket.on('disconnect', () => {
      console.log('ElSpark TV client disconnected:', socket.id);
      
      // Find and remove user from active users
      for (const [profileId, socketId] of activeElsparkUsers.entries()) {
        if (socketId === socket.id) {
          activeElsparkUsers.delete(profileId);
          break;
        }
      }
    });
  });

  // Load initial video if none playing
  loadInitialVideo(elsparkNamespace);
}

export async function playNextVideo(namespace: any) {
  try {
    // Mark current video as played
    if (currentVideoState.video) {
      await prisma.liveTVQueue.update({
        where: { id: currentVideoState.video.id },
        data: { 
          status: 'played',
          endTime: new Date()
        }
      });
    }

    // Get next video from queue
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

    if (nextVideo) {
      // Update queue item status
      await prisma.liveTVQueue.update({
        where: { id: nextVideo.id },
        data: { 
          status: 'playing',
          startTime: new Date()
        }
      });

      // Update current state - FIX: Include the uploader data
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
            uploader: nextVideo.video.uploader // ADD THIS LINE
          }
        },
        currentTime: 0,
        isPlaying: true,
        startedAt: Date.now()
      };

      console.log('Broadcasting video:started event for:', nextVideo.video.title);
      console.log('Current video state:', JSON.stringify(currentVideoState, null, 2));

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
    } else {
      // No videos in queue
      console.log('No videos in queue, emitting queue_empty');
      currentVideoState = {
        video: null,
        currentTime: 0,
        isPlaying: false,
        startedAt: 0
      };

      namespace.to('live-tv-main').emit('video:queue_empty');
    }
  } catch (error) {
    console.error('Error playing next video:', error);
  }
}


async function loadInitialVideo(namespace: any) {
  try {
    // Check if there's a currently playing video
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
      // Resume existing playing video - FIX: Include uploader
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
            uploader: playingVideo.video.uploader // ADD THIS LINE
          }
        },
        currentTime: 0,
        isPlaying: true,
        startedAt: Date.now()
      };
      console.log('Resumed existing playing video:', playingVideo.video.title);
    } else {
      // No playing video, start the first one in queue
      console.log('No playing video found, attempting to play next video');
      await playNextVideo(namespace);
    }
  } catch (error) {
    console.error('Error loading initial video:', error);
  }
}


function startVideoSyncBroadcast(namespace: any) {
  // Clear existing interval if any
  if (videoSyncInterval) {
    clearInterval(videoSyncInterval);
  }

  // Broadcast current video state every 5 seconds
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

      // Check if video should end
      if (currentVideoState.currentTime >= currentVideoState.video.video.duration) {
        playNextVideo(namespace);
      }
    }
  }, 5000);
}


export async function checkAndStartPlayback(namespace: any) {
  try {
    const current = await elsparkService.getCurrentVideo();
    const queue = await elsparkService.getQueue();
    
    console.log('[PLAYBACK CHECK]', { 
      hasCurrentVideo: !!current, 
      queueLength: queue.length,
      currentVideoState: currentVideoState.video ? 'has video' : 'empty',
      currentVideoPlaying: currentVideoState.isPlaying
    });
    
    // Check if nothing is playing but queue has videos
    const shouldStart = (
      (!current || !currentVideoState.video || !currentVideoState.isPlaying) && 
      queue.length > 0
    );
    
    if (shouldStart) {
      console.log('[PLAYBACK] Starting playback - queue has videos but nothing playing');
      await playNextVideo(namespace);
      return true;
    }
    
    console.log('[PLAYBACK] No action needed - video already playing or queue empty');
    return false;
  } catch (error) {
    console.error('[PLAYBACK CHECK ERROR]:', error);
    return false;
  }
}

// Utility function to emit to specific user
export function emitToUser(profileId: number, event: string, data: any, io: Server) {
  const namespace = io.of('/elspark-tv');
  namespace.to(`user:${profileId}`).emit(event, data);
}

// Utility function to broadcast queue update
export async function broadcastQueueUpdate(io: Server) {
  const namespace = io.of('/elspark-tv');
  const queue = await elsparkService.getQueue();
  namespace.to('live-tv-main').emit('video:queue_update', { queue });
}

// Utility function to emit coin update
export function emitCoinUpdate(profileId: number, newBalance: number, io: Server) {
  emitToUser(profileId, 'user:coin_update', { balance: newBalance }, io);
}

// Utility function to emit collection update
export function emitCollectionUpdate(profileId: number, io: Server) {
  emitToUser(profileId, 'collection:updated', { timestamp: Date.now() }, io);
}