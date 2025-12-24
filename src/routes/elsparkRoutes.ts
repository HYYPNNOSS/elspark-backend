import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ElsparkService } from '../services/elspark.service';
import { emitCoinUpdate, broadcastQueueUpdate } from '../sockets/elspark.socket';

const router = express.Router();
const elsparkService = new ElsparkService();

// Use system temp directory for temporary file storage
const tempDir = path.join(os.tmpdir(), 'elspark-temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Multer configuration
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
    fileSize: 500 * 1024 * 1024 // 500MB max
  }
});

// Middleware
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

// ========== COLLECTION ROUTES ==========

/**
 * POST /api/elspark/collection/upload
 * Upload video to collection (1 elsCoin)
 * User becomes initial owner with 100% ownership
 */
router.post('/collection/upload', upload.single('video'), async (req: Request, res: Response) => {
  // Validate profileId after multer parses it
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

    // Emit socket events
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

/**
 * GET /api/elspark/collection
 * Get user's owned videos
 */
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


/**
 * POST /api/elspark/collection/purchase/:videoId
 * Purchase ownership share of video (2 elsCoins)
 * Revenue distributed among existing owners
 */
router.post('/collection/purchase/:videoId', validateProfileIdBody, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { profileId } = req.body;

    const result = await elsparkService.purchaseVideo(profileId, videoId);

    // Emit socket events to buyer and all owners who received revenue
    if (req.app.get('io')) {
      const io = req.app.get('io');
      emitCoinUpdate(profileId, result.buyerNewBalance, io);
      
      // Notify all owners who received revenue
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

/**
 * POST /api/elspark/collection/post/:videoId
 * Post owned video to Live TV (FREE)
 */
// Replace the POST /api/elspark/collection/post/:videoId route in elsparkRoutes.ts

router.post('/collection/post/:videoId', validateProfileIdBody, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { profileId } = req.body;

    const result = await elsparkService.postToLiveTV(profileId, videoId);

    if (req.app.get('io')) {
      const io = req.app.get('io');
      const namespace = io.of('/elspark-tv');
      const { playNextVideo, broadcastQueueUpdate } = require('../sockets/elspark.socket');
      
      console.log('[POST] Video posted to queue');
      
      // Broadcast queue update
      await broadcastQueueUpdate(io);
      
      // If flag says we should start playback, do it immediately
      if (result.shouldStartPlayback) {
        console.log('[POST] No video playing, starting playback immediately');
        
        // Small delay to ensure HTTP response is sent
        setTimeout(async () => {
          await playNextVideo(namespace);
        }, 100);
      } else {
        console.log('[POST] Video already playing, added to queue');
      }
    }

    res.status(201).json({
      success: true,
      message: 'Video posted to Live TV',
      data: result
    });
  } catch (error: any) {
    console.error('[POST ERROR]:', error);
    res.status(400).json({ 
      error: error.message || 'Failed to post video to Live TV' 
    });
  }
});
//  router.post('/collection/post/:videoId', validateProfileIdBody, async (req: Request, res: Response) => {
//   try {
//     const { videoId } = req.params;
//     const { profileId } = req.body;

//     const result = await elsparkService.postToLiveTV(profileId, videoId);

//     if (req.app.get('io')) {
//       const io = req.app.get('io');
//       const namespace = io.of('/elspark-tv');
//       const { checkAndStartPlayback, broadcastQueueUpdate } = require('../sockets/elspark.socket');
      
//       console.log('[POST] Video posted to queue, checking playback state...');
      
//       // First broadcast queue update
//       await broadcastQueueUpdate(io);
      
//       // Immediately try to start playback (no delay)
//       const started = await checkAndStartPlayback(namespace);
//       console.log('[POST] Playback check result:', started);
      
//       // If it didn't start, try again after a short delay
//       if (!started) {
//         setTimeout(async () => {
//           console.log('[POST] Retrying playback check...');
//           await checkAndStartPlayback(namespace);
//         }, 1000);
//       }
//     }

//     res.status(201).json({
//       success: true,
//       message: 'Video posted to Live TV',
//       data: result
//     });
//   } catch (error: any) {
//     console.error('[POST ERROR]:', error);
//     res.status(400).json({ 
//       error: error.message || 'Failed to post video to Live TV' 
//     });
//   }
// });

/**
 * DELETE /api/elspark/collection/:videoId
 * Remove ownership from video or delete if sole owner
 */
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

// ========== VIDEO ROUTES ==========

/**
 * GET /api/elspark/videos/:id
 * Get video details with ownership info
 */
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

/**
 * DELETE /api/elspark/videos/:id
 * Delete video (only if sole owner)
 */
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

// ========== LIVE TV ROUTES ==========

/**
 * GET /api/elspark/live-tv/queue
 * Get current queue
 */
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

/**
 * GET /api/elspark/live-tv/current
 * Get currently playing video
 */
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

/**
 * GET /api/elspark/live-tv/history
 * Get video history
 */
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

// ========== ELSCOIN ROUTES ==========

/**
 * GET /api/elspark/coins/balance
 * Get user's elsCoin balance
 */
router.get('/coins/balance', validateProfileIdQuery, async (req: Request, res: Response) => {
  try {
    const profileId = res.locals.profileId; // Changed from req.body.profileId

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

/**
 * GET /api/elspark/coins/transactions
 * Get user's transaction history
 */
router.get('/coins/transactions', validateProfileIdQuery, async (req: Request, res: Response) => {
  try {
    const profileId = res.locals.profileId; // Changed from req.body.profileId

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