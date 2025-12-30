import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ElsparkService } from '../services/elspark.service';
import { emitCoinUpdate, broadcastQueueUpdate, checkAndStartPlayback } from '../sockets/elspark.socket';

const router = express.Router();
const elsparkService = new ElsparkService();

const tempDir = path.join(os.tmpdir(), 'elspark-temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'temp-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|webm|ogg|avi|mov|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only video files (mp4, webm, ogg, avi, mov, mkv) are allowed'));
    }
  },
  limits: { 
    fileSize: 500 * 1024 * 1024
  }
});

const validateProfileIdBody = (req: Request, res: Response, next: Function) => {
  const profileId = parseInt(req.body.profileId);
  
  if (!profileId || isNaN(profileId)) {
    res.status(400).json({ error: 'Valid profileId is required in body' });
    return;
  }
  
  req.body.profileId = profileId;
  next();
};

const validateProfileIdQuery = (req: Request, res: Response, next: Function) => {
  const profileId = parseInt(req.query.profileId as string);
  
  if (!profileId || isNaN(profileId)) {
    res.status(400).json({ error: 'Valid profileId is required in query' });
    return;
  }
  
  res.locals.profileId = profileId;
  next();
};

router.post('/collection/upload', upload.single('video'), async (req: Request, res: Response) => {
  const profileId = parseInt(req.body.profileId);
  
  if (!profileId || isNaN(profileId)) {
    res.status(400).json({ error: 'Valid profileId is required' });
    return;
  }
  
  req.body.profileId = profileId;

  try {
    if (!req.file) {
      res.status(400).json({ error: 'No video file uploaded' });
      return;
    }

    const { profileId, title, description } = req.body;

    if (!title || title.trim().length === 0) {
      res.status(400).json({ error: 'Video title is required' });
      return;
    }

    const result = await elsparkService.uploadToCollection(
      profileId,
      req.file,
      title.trim(),
      description?.trim()
    );

    if (req.app.get('io')) {
      const io = req.app.get('io');
      emitCoinUpdate(profileId, result.newBalance, io);
    }

    res.status(201).json({
      success: true,
      message: 'Video uploaded to collection successfully',
      data: {
        video: result.video,
        newBalance: result.newBalance
      }
    });
  } catch (error: any) {
    console.error('Error uploading video to collection:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(400).json({ 
      error: error.message || 'Failed to upload video to collection' 
    });
  }
});

router.get('/live-tv/health', async (req, res) => {
  const queue = await elsparkService.getQueue();
  const current = await elsparkService.getCurrentVideo();
  
  res.json({
    isPlaying: !!current,
    queueLength: queue.length,
    currentVideo: current?.video.title || null,
    uptime: process.uptime()
  });
});

router.get('/collection', validateProfileIdQuery, async (req: Request, res: Response) => {
  try {
    const profileId = res.locals.profileId;
    const collection = await elsparkService.getUserCollection(profileId);

    res.json({
      success: true,
      data: collection
    });
  } catch (error: any) {
    console.error('Error fetching collection:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch collection' 
    });
  }
});

router.post('/collection/purchase/:videoId', validateProfileIdBody, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { profileId } = req.body;

    const result = await elsparkService.purchaseVideo(profileId, videoId);

    if (req.app.get('io')) {
      const io = req.app.get('io');
      emitCoinUpdate(profileId, result.buyerNewBalance, io);
      
      for (const update of result.ownerUpdates) {
        emitCoinUpdate(update.profileId, update.newBalance, io);
      }
    }

    res.status(201).json({
      success: true,
      message: `Video ownership purchased successfully. You now own ${result.newOwnershipShare.toFixed(1)}%`,
      data: {
        ownership: result.ownership,
        newBalance: result.buyerNewBalance,
        ownershipShare: result.newOwnershipShare
      }
    });
  } catch (error: any) {
    console.error('Error purchasing video:', error);
    res.status(400).json({ 
      error: error.message || 'Failed to purchase video' 
    });
  }
});

// CRITICAL FIX: Improved post route with guaranteed playback
router.post('/collection/post/:videoId', validateProfileIdBody, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { profileId } = req.body;

    console.log('[POST ROUTE] Starting - videoId:', videoId, 'profileId:', profileId);

    // Step 1: Add to queue (in service)
    const result = await elsparkService.postToLiveTV(profileId, videoId);

    console.log('[POST ROUTE] Video added to queue:', {
      queueItemId: result.queueItem.id,
      position: result.queueItem.position,
      status: result.queueItem.status,
      shouldStartPlayback: result.shouldStartPlayback
    });

    // Step 2: Broadcast queue update immediately
    if (req.app.get('io')) {
      const io = req.app.get('io');
      const namespace = io.of('/elspark-tv');
      
      await broadcastQueueUpdate(io);
      console.log('[POST ROUTE] Queue update broadcasted');

      // Step 3: Start playback with retry logic (non-blocking)
      // Using setImmediate to ensure it runs after response
      setImmediate(async () => {
        console.log('[POST ROUTE] Triggering playback check...');
        
        // Multiple attempts to ensure playback starts
        for (let i = 0; i < 3; i++) {
          const started = await checkAndStartPlayback(namespace);
          
          if (started) {
            console.log(`[POST ROUTE] Playback started successfully on attempt ${i + 1}`);
            break;
          }
          
          if (i < 2) {
            console.log(`[POST ROUTE] Attempt ${i + 1} failed, retrying in 500ms...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      });
    }

    // Step 4: Send immediate response
    // Emit coin update
if (req.app.get('io')) {
  const io = req.app.get('io');
  emitCoinUpdate(profileId, result.newBalance, io);
}

res.status(201).json({
  success: true,
  message: 'Video posted to Live TV successfully (1 coin deducted)',
  data: {
    queueItem: result.queueItem,
    position: result.queueItem.position,
    newBalance: result.newBalance
  }
});
    
    console.log('[POST ROUTE] Response sent to client');
  } catch (error: any) {
    console.error('[POST ROUTE ERROR]:', error);
    res.status(400).json({ 
      error: error.message || 'Failed to post video to Live TV' 
    });
  }
});

router.delete('/collection/:videoId', validateProfileIdBody, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { profileId } = req.body;

    await elsparkService.removeFromCollection(profileId, videoId);

    res.json({
      success: true,
      message: 'Ownership removed from video'
    });
  } catch (error: any) {
    console.error('Error removing from collection:', error);
    res.status(400).json({ 
      error: error.message || 'Failed to remove video from collection' 
    });
  }
});

router.get('/videos/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const video = await elsparkService.getVideoDetails(id);

    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    res.json({
      success: true,
      data: video
    });
  } catch (error: any) {
    console.error('Error fetching video details:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch video details' 
    });
  }
});

router.delete('/videos/:id', validateProfileIdBody, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { profileId } = req.body;

    await elsparkService.deleteVideo(profileId, id);

    if (req.app.get('io')) {
      const io = req.app.get('io');
      broadcastQueueUpdate(io);
    }

    res.json({
      success: true,
      message: 'Video deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting video:', error);
    res.status(400).json({ 
      error: error.message || 'Failed to delete video' 
    });
  }
});

router.get('/live-tv/queue', async (req: Request, res: Response) => {
  try {
    const queue = await elsparkService.getQueue();

    res.json({
      success: true,
      data: queue
    });
  } catch (error: any) {
    console.error('Error fetching queue:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch queue' 
    });
  }
});

router.get('/live-tv/current', async (req: Request, res: Response) => {
  try {
    const current = await elsparkService.getCurrentVideo();

    res.json({
      success: true,
      data: current
    });
  } catch (error: any) {
    console.error('Error fetching current video:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch current video' 
    });
  }
});

router.get('/live-tv/history', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const history = await elsparkService.getHistory(limit);

    res.json({
      success: true,
      data: history
    });
  } catch (error: any) {
    console.error('Error fetching history:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch history' 
    });
  }
});

router.get('/coins/balance', validateProfileIdQuery, async (req: Request, res: Response) => {
  try {
    const profileId = res.locals.profileId;
    const balance = await elsparkService.getCoinBalance(profileId);

    res.json({
      success: true,
      data: { balance }
    });
  } catch (error: any) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch balance' 
    });
  }
});

router.get('/coins/transactions', validateProfileIdQuery, async (req: Request, res: Response) => {
  try {
    const profileId = res.locals.profileId;
    const transactions = await elsparkService.getTransactionHistory(profileId);

    res.json({
      success: true,
      data: transactions
    });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch transactions' 
    });
  }
});

export default router;