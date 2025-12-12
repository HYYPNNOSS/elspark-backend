import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ElsparkService } from '../services/elspark.service';
import { emitCoinUpdate, emitCollectionUpdate, broadcastQueueUpdate } from '../sockets/elspark.socket';

const router = express.Router();
const elsparkService = new ElsparkService();

// Use system temp directory for temporary file storage before uploading to Wasabi
const tempDir = path.join(os.tmpdir(), 'elspark-temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Multer configuration for video uploads (temporary local storage)
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

// Middleware to validate profileId
const validateProfileId = (req: Request, res: Response, next: Function) => {
  const profileId = parseInt(req.body.profileId || req.query.profileId as string);
  
  if (!profileId || isNaN(profileId)) {
    res.status(400).json({ error: 'Valid profileId is required' });
    return;
  }
  
  req.body.profileId = profileId;
  next();
};

// ========== VIDEO MANAGEMENT ROUTES ==========

/**
 * POST /api/elspark/videos/upload
 * Upload video directly to Live TV (1 elsCoin)
 */
router.post('/videos/upload', upload.single('video'), validateProfileId, async (req: Request, res: Response) => {
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

    const result = await elsparkService.uploadToLiveTV(
      profileId,
      req.file,
      title.trim(),
      description?.trim()
    );

    // Emit socket events
    if (req.app.get('io')) {
      const io = req.app.get('io');
      emitCoinUpdate(profileId, result.newBalance, io);
      broadcastQueueUpdate(io);
    }

    res.status(201).json({
      success: true,
      message: 'Video uploaded to Live TV successfully',
      data: {
        video: result.video,
        queueItem: result.queueItem,
        newBalance: result.newBalance
      }
    });
  } catch (error: any) {
    console.error('Error uploading video to Live TV:', error);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(400).json({ 
      error: error.message || 'Failed to upload video' 
    });
  }
});

/**
 * GET /api/elspark/videos/:id
 * Get video details
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
 * Delete video (only owner can delete)
 */
router.delete('/videos/:id', validateProfileId, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { profileId } = req.body;

    await elsparkService.deleteVideo(profileId, id);

    // Emit socket events
    if (req.app.get('io')) {
      const io = req.app.get('io');
      broadcastQueueUpdate(io);
      emitCollectionUpdate(profileId, io);
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

// ========== COLLECTION ROUTES ==========

/**
 * POST /api/elspark/collection/upload
 * Upload video to collection (1 elsCoin)
 */
router.post('/collection/upload', upload.single('video'), validateProfileId, async (req: Request, res: Response) => {
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
      emitCollectionUpdate(profileId, io);
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
    
    // Clean up uploaded file on error
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
 * Get user's collection
 */
router.get('/collection', validateProfileId, async (req: Request, res: Response) => {
  try {
    const { profileId } = req.query;

    const collection = await elsparkService.getUserCollection(parseInt(profileId as string));

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
 * POST /api/elspark/collection/add/:videoId
 * Purchase video for collection (2 elsCoins)
 */
router.post('/collection/add/:videoId', validateProfileId, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { profileId } = req.body;

    const result = await elsparkService.purchaseVideo(profileId, videoId);

    // Emit socket events to both buyer and uploader
    if (req.app.get('io')) {
      const io = req.app.get('io');
      emitCoinUpdate(profileId, result.buyerNewBalance, io);
      emitCoinUpdate(result.uploaderId, result.uploaderNewBalance, io);
      emitCollectionUpdate(profileId, io);
    }

    res.status(201).json({
      success: true,
      message: 'Video purchased successfully',
      data: {
        collectionItem: result.collectionItem,
        newBalance: result.buyerNewBalance
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
 * DELETE /api/elspark/collection/:videoId
 * Remove video from collection
 */
router.delete('/collection/:videoId', validateProfileId, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { profileId } = req.body;

    await elsparkService.removeFromCollection(profileId, videoId);

    // Emit socket event
    if (req.app.get('io')) {
      const io = req.app.get('io');
      emitCollectionUpdate(profileId, io);
    }

    res.json({
      success: true,
      message: 'Video removed from collection'
    });
  } catch (error: any) {
    console.error('Error removing from collection:', error);
    res.status(400).json({ 
      error: error.message || 'Failed to remove video from collection' 
    });
  }
});

/**
 * POST /api/elspark/collection/post/:videoId
 * Post video from collection to Live TV
 */
router.post('/collection/post/:videoId', validateProfileId, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const { profileId } = req.body;

    const result = await elsparkService.postToLiveTV(profileId, videoId);

    // Emit socket event
    if (req.app.get('io')) {
      const io = req.app.get('io');
      broadcastQueueUpdate(io);
    }

    res.status(201).json({
      success: true,
      message: 'Video posted to Live TV',
      data: result
    });
  } catch (error: any) {
    console.error('Error posting to Live TV:', error);
    res.status(400).json({ 
      error: error.message || 'Failed to post video to Live TV' 
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
router.get('/coins/balance', validateProfileId, async (req: Request, res: Response) => {
  try {
    const { profileId } = req.query;

    const balance = await elsparkService.getCoinBalance(parseInt(profileId as string));

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
router.get('/coins/transactions', validateProfileId, async (req: Request, res: Response) => {
  try {
    const { profileId } = req.query;

    const transactions = await elsparkService.getTransactionHistory(parseInt(profileId as string));

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