import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { ElsparkService } from "../services/elspark.service";

const prisma = new PrismaClient();
const elsparkService = new ElsparkService();

let isFillerMode = false;
let fillerVideoQueue: any[] = [];
let playedFillerVideoIds: string[] = []; 

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

  setInterval(async () => {
    if (!currentVideoState.isPlaying) {
      console.log('[SAFETY CHECK] No video playing, checking queue...');
      await checkAndStartPlayback(elsparkNamespace);
    }
  }, 30000);

  
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
        
        // Get filler videos if queue is empty
        let fillerInfo = null;
        if (queue.length === 0 && isFillerMode) {
          const fillerVideos = await elsparkService.getFillerVideos(10, playedFillerVideoIds);
          fillerInfo = {
            fillerQueue: fillerVideos,
            isFillerMode: true,
            currentFillerQueue: fillerVideoQueue
          };
        }
        
        socket.emit('initial:state', {
          currentVideo: currentVideoState,
          queue,
          recentMessages: recentChatMessages.slice(-50),
          coinBalance: profile.account.cyberCoins.toNumber(),
          userProfile: {
            id: profile.id,
            username: profile.username,
            profilePicture: profile.profilePicture
          },
          ...(fillerInfo && fillerInfo)
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

export async function playNextVideo(namespace: any, retryCount = 0): Promise<boolean> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 200;
  
  try {
    console.log(`[PLAY NEXT] Attempt ${retryCount + 1}/${MAX_RETRIES + 1}`);
    
    // Mark current video as played
    if (currentVideoState.video) {
      console.log('[PLAY NEXT] Marking current video as played:', currentVideoState.video.video.title);
      
      // If it was a filler video, add to played list
      if (isFillerMode) {
        playedFillerVideoIds.push(currentVideoState.video.videoId);
        await elsparkService.markFillerVideoPlayed(currentVideoState.video.videoId);
        console.log(`[PLAY NEXT] 📝 Marked filler video as played. Total played in cycle: ${playedFillerVideoIds.length}`);
        
        // IMPORTANT: Keep video status as 'collection' so it can be used again
        // (Don't change status for filler videos, they stay in collection)
      } else {
        // For user-posted videos, mark as played in queue
        await prisma.liveTVQueue.update({
          where: { id: currentVideoState.video.id },
          data: { 
            status: 'played',
            endTime: new Date()
          }
        });
        
        // Reset video status back to 'collection' after it finishes playing from queue
        await prisma.elsparkVideo.update({
          where: { id: currentVideoState.video.videoId },
          data: { status: 'collection' } // Changed from 'in_collection'
        });
        console.log('[PLAY NEXT] 🔄 Reset video status to "collection"');
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Check for user-posted videos first (priority)
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

    // USER VIDEO FOUND - Exit filler mode and play it
    if (nextVideo) {
      console.log('[PLAY NEXT] 🎯 USER VIDEO FOUND - Exiting filler mode');
      isFillerMode = false;
      fillerVideoQueue = [];
      playedFillerVideoIds = []; // Reset played tracking
      
      await prisma.liveTVQueue.update({
        where: { id: nextVideo.id },
        data: { 
          status: 'playing',
          startTime: new Date()
        }
      });

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

      console.log('[PLAY NEXT] ▶️  Playing user video:', nextVideo.video.title);

      namespace.to('live-tv-main').emit('video:started', {
        video: currentVideoState.video,
        isFiller: false,
        timestamp: new Date().toISOString()
      });

      const updatedQueue = await elsparkService.getQueue();
      namespace.to('live-tv-main').emit('video:queue_update', { queue: updatedQueue });
      
      return true;
    }

    // NO USER VIDEOS - Enter/Continue filler mode
    console.log('[PLAY NEXT] 📺 No user videos - entering/continuing filler mode');
    isFillerMode = true;

    // Load filler queue if empty OR if we need more videos
    if (fillerVideoQueue.length === 0) {
      console.log('[PLAY NEXT] 🔄 Filler queue empty - loading videos...');
      
      // Get videos, excluding ones we've already played this cycle
      const excludeIds = [...playedFillerVideoIds];
      console.log(`[PLAY NEXT] 🚫 Excluding ${excludeIds.length} already-played videos from this cycle`);
      
      let fillerVideos = await elsparkService.getFillerVideos(30, excludeIds);
      
      if (fillerVideos.length === 0) {
        console.log('[PLAY NEXT] ❌ No videos available in collections!');
        currentVideoState = {
          video: null,
          currentTime: 0,
          isPlaying: false,
          startedAt: 0
        };
        isFillerMode = false;
        playedFillerVideoIds = [];
        namespace.to('live-tv-main').emit('video:queue_empty');
        return false;
      }
      
      fillerVideoQueue = fillerVideos;
      console.log(`[PLAY NEXT] ✅ Loaded ${fillerVideoQueue.length} videos into filler queue`);
      console.log(`[PLAY NEXT] 🎬 Next up: ${fillerVideoQueue.slice(0, 3).map(v => v.title).join(', ')}...`);
    }

    // Pre-load more videos when queue gets low (keep it filled)
    if (fillerVideoQueue.length <= 5) {
      console.log('[PLAY NEXT] ⚠️  Queue running low, pre-loading more videos...');
      
      // Get videos already in queue + already played this cycle
      const alreadyHandledIds = [
        ...fillerVideoQueue.map(v => v.id),
        ...playedFillerVideoIds
      ];
      
      console.log(`[PLAY NEXT] 🚫 Excluding ${alreadyHandledIds.length} videos (${fillerVideoQueue.length} queued + ${playedFillerVideoIds.length} played)`);
      
      const moreVideos = await elsparkService.getFillerVideos(20, alreadyHandledIds);
      
      if (moreVideos.length > 0) {
        fillerVideoQueue.push(...moreVideos);
        console.log(`[PLAY NEXT] ➕ Added ${moreVideos.length} more videos (queue now: ${fillerVideoQueue.length})`);
      } else {
        console.log('[PLAY NEXT] 🔄 All videos played - will reset cycle after current queue empties');
        // Don't reset yet - let current queue finish, then getFillerVideos will reset automatically
      }
    }

    // If still no videos after all attempts
    if (fillerVideoQueue.length === 0) {
      console.log('[PLAY NEXT] ❌ CRITICAL: Queue still empty after loading attempts');
      currentVideoState = {
        video: null,
        currentTime: 0,
        isPlaying: false,
        startedAt: 0
      };
      isFillerMode = false;
      playedFillerVideoIds = [];
      namespace.to('live-tv-main').emit('video:queue_empty');
      return false;
    }

    // Play next filler video from queue
    const nextFiller = fillerVideoQueue.shift()!;
    console.log(`[PLAY NEXT] ▶️  Playing: "${nextFiller.title}"`);
    console.log(`[PLAY NEXT] 📊 Queue remaining: ${fillerVideoQueue.length} | Played this cycle: ${playedFillerVideoIds.length + 1}`);

    currentVideoState = {
      video: {
        id: `filler-${nextFiller.id}`,
        videoId: nextFiller.id,
        position: 0,
        status: 'playing',
        video: {
          id: nextFiller.id,
          title: nextFiller.title,
          url: nextFiller.url,
          duration: nextFiller.duration,
          uploaderId: nextFiller.uploaderId,
          uploader: nextFiller.uploader
        }
      },
      currentTime: 0,
      isPlaying: true,
      startedAt: Date.now()
    };

    console.log('[PLAY NEXT] 🎬 Video info:', {
      title: nextFiller.title,
      duration: nextFiller.duration,
      queueRemaining: fillerVideoQueue.length
    });

    namespace.to('live-tv-main').emit('video:started', {
      video: currentVideoState.video,
      isFiller: true,
      timestamp: new Date().toISOString()
    });
    
    // Emit current filler queue state
    namespace.to('live-tv-main').emit('video:filler_queue', {
      fillerQueue: fillerVideoQueue.slice(0, 10), // Send next 10 videos
      isFillerMode: true,
      playedCount: playedFillerVideoIds.length
    });

    return true;

  } catch (error) {
    console.error('[PLAY NEXT ERROR]:', error);
    
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY * Math.pow(2, retryCount);
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

      // Add 1 second buffer to ensure video actually ends
      if (currentVideoState.currentTime >= (currentVideoState.video.video.duration - 1)) {
        console.log('[SYNC] Video duration reached, playing next...');
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
    
    const [current, queue] = await Promise.all([
      prisma.liveTVQueue.findFirst({
        where: { status: 'playing' },
      }),
      prisma.liveTVQueue.findMany({
        where: { status: 'waiting' },
        orderBy: { position: 'asc' },
        take: 5,
      })
    ]);
    
    console.log('[PLAYBACK CHECK]', { 
      hasCurrentVideo: !!current, 
      queueLength: queue.length,
      isFillerMode,
      currentVideoPlaying: currentVideoState.isPlaying,
    });
    
    // Start playback if nothing is playing (user videos OR filler)
    if (!current && !currentVideoState.isPlaying) {
      console.log('[PLAYBACK] Starting playback');
      return await playNextVideo(namespace);
    }
    
    if (retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return checkAndStartPlayback(namespace, retryCount + 1);
    }
    
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
  
  // If queue is empty, also send filler queue info
  if (queue.length === 0) {
    const fillerVideos = await elsparkService.getFillerVideos(10, []);
    namespace.to('live-tv-main').emit('video:filler_queue', { 
      fillerQueue: fillerVideos,
      isFillerMode: true 
    });
  }
}

export function emitCoinUpdate(profileId: number, newBalance: number, io: Server) {
  emitToUser(profileId, 'user:coin_update', { balance: newBalance }, io);
}

export function emitCollectionUpdate(profileId: number, io: Server) {
  emitToUser(profileId, 'collection:updated', { timestamp: Date.now() }, io);
}