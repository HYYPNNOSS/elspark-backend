import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { aiMiddleware } from '../middlewares/aiMiddleware'; 

const router = express.Router();
const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    userId: number;
    profileId: number;
    accountId: number;
    email: string;
  };
}

interface BotConfig {
  name: string;
  emoji: string;
}

// POST /api/ai-sessions - Create new AI session
router.post('/', aiMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { botId, duration, cost }: { botId: number; duration: number; cost: number } = req.body;
    const profileId = req.user?.profileId || req.user?.userId;
    const accountId = req.user?.accountId;

    console.log("profileId:", profileId);
    console.log("accountId:", accountId);

    if (!req.user || !profileId) {
      console.log("Unauthorized: no user in request");
      res.status(401).json({ error: 'Unauthorized: no user in request' });
      return;
    }

    // Get profile with account data
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      include: { account: true }
    });

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    // Convert Decimal to number for comparison
    const userCoins = profile.account.cyberCoins ? Number(profile.account.cyberCoins) : 0;

    if (userCoins < cost) {
      res.status(400).json({ error: 'Insufficient coins' });
      return;
    }

    // Create AI session linked to profile
    const endTime = new Date(Date.now() + duration * 60 * 1000);
    const session = await prisma.aISession.create({
      data: {
        profileId: profileId, // userId field now references profileId
        botId,
        duration,
        endTime,
        isActive: true
      }
    });

    // Deduct coins from account using decrement
    await prisma.account.update({
      where: { id: profile.accountId },
      data: { cyberCoins: { decrement: cost } }
    });

    res.json({ 
      sessionId: session.id,
      endTime: session.endTime 
    });

  } catch (error) {
    console.error('Error creating AI session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ai-sessions/active - Get user's active sessions
router.get('/active', aiMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.user?.profileId || req.user?.userId;
    
    if (!profileId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const now = new Date();

    const BOT_CONFIG: Record<number, BotConfig> = {
      1: { name: "Aero", emoji: "🧠" },
      2: { name: "Zayd", emoji: "👨‍🍳" },
      3: { name: "OneRoid", emoji: "🌙" },
      4: { name: "Zainab", emoji: "🏊‍♀️" }
    };

    // Get active sessions for this profile
    const sessions = await prisma.aISession.findMany({
      where: {
        profileId: profileId, // userId field references profileId
        isActive: true,
        endTime: { gt: now }
      }
    });

    // Format for frontend
    const aiBots = sessions.map((session: any) => ({
      id: session.botId,
      name: BOT_CONFIG[session.botId]?.name || 'Unknown',
      emoji: BOT_CONFIG[session.botId]?.emoji || '🤖',
      sessionId: session.id,
      endTime: session.endTime.toISOString()
    }));

    res.json(aiBots);

  } catch (error) {
    console.error('Error fetching active sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/ai-sessions/cleanup - Cleanup expired sessions
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    
    await prisma.aISession.updateMany({
      where: {
        endTime: { lt: now },
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    res.json({ message: 'Sessions cleaned up' });
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;