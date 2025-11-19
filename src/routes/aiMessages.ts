import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../middlewares/authMiddleware'; 


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

router.get('/:sessionId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.profileId || req.user?.userId;

if (!userId) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}

    const session = await prisma.aISession.findFirst({
      where: {
        id: sessionId,
        profileId: userId
      }
    });

    if (!session) {
       res.status(404).json({ error: 'Session not found' });
       return
    }

    const messages = await prisma.aIMsg.findMany({
      where: {
        profileId: userId,
        sessionId
      },
      orderBy: { createdAt: 'asc' }
    });

const formattedMessages = messages.map(msg => ({
  id: msg.id,
  content: msg.message,
  senderId: msg.sender === 'user' ? userId : `bot-${session.botId}`,
  receiverId: msg.sender === 'user' ? session.botId : userId,
  createdAt: msg.createdAt.toISOString()
}));

    res.json(formattedMessages);

  } catch (error) {
    console.error('Error fetching AI messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



export default router;