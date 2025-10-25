import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { aiMiddleware } from '../middlewares/aiMiddleware'; 


const router = express.Router();
const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    userId: number;
    email: string;
  };
}



// GET /api/ai-messages/:sessionId - Get messages for a session
router.get('/:sessionId', aiMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.userId;

    // Verify session belongs to user
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

    // Get messages for this session
    const messages = await prisma.aIMsg.findMany({
      where: {
        profileId: userId,
        sessionId
      },
      orderBy: { createdAt: 'asc' }
    });

    // Format messages for chat interface
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      content: msg.message,
      senderId: msg.sender === 'user' ? userId : session.botId,
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