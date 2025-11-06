import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../middlewares/authMiddleware'; 

const router = express.Router();
const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    // userId: number;
    profileId: number;
    // email: string;
  };
}

interface BotPersonality {
  prompt: string;
  responses: string[];
}

class AIResponseService {
  static async generateResponse(botId: number, message: string, userId: number): Promise<string> {
    const botPersonalities: Record<number, BotPersonality> = {
      1: { prompt: "You are Aero, a friendly language learning assistant.", responses: [] },
      2: { prompt: "You are PULSE, a Mind coach companion.", responses: [] },
      3: { prompt: "You are NOVA, a Creative advisor.", responses: [] },
      4: { prompt: "You are QUANTUM, a Tech specialist.", responses: [] }
    };

    const bot = botPersonalities[botId];
    if (!bot) return "I'm not sure how to respond to that.";

    const GEMINI_API_KEY = "AIzaSyCyPKk6ZixxVtrSTvwnLe4-pb7q7Uzfioc";
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    
    const payload = {
      contents: [
        {
          parts: [
            { text: bot.prompt + "\nUser: " + message }
          ]
        }
      ]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("Gemini API error:", response.status, await response.text());
      return "Sorry, I couldn't generate a response.";
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      return "Sorry, I couldn't think of anything to say.";
    }

    const MAX_MESSAGE_LENGTH = 1000;
    const trimmedText = text.length > MAX_MESSAGE_LENGTH ? text.slice(0, MAX_MESSAGE_LENGTH) : text;
    return trimmedText;
  }
}

router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
  console.log('👤 req.user:', req.user);
  try {
    const { sessionId, message, botId }: { 
      sessionId: string; 
      message: string; 
      botId: number; 
    } = req.body;

    // Validate request body
    if (!sessionId || !message || !botId) {
      res.status(400).json({ error: 'Missing required fields: sessionId, message, botId' });
      return;
    }
    console.log(req.user?.profileId)
    // Check authentication
    const userId = req.user?.profileId;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Verify session is active
    const session = await prisma.aISession.findFirst({
      where: {
        id: sessionId,
        profileId: userId,
        isActive: true,
        endTime: { gt: new Date() }
      }
    });

    if (!session) {
      res.status(400).json({ error: 'Session expired or invalid' });
      return;
    }

    // Store user message
    await prisma.aIMsg.create({
      data: {
        profileId: userId,
        sender: 'user',
        message,
        sessionId
      }
    });

    // Generate AI response
    const aiResponse = await AIResponseService.generateResponse(botId, message, userId);

    // Store AI response
    await prisma.aIMsg.create({
      data: {
        profileId: userId,
        sender: 'bot',
        message: aiResponse,
        sessionId
      }
    });

    res.json({ response: aiResponse });
  } catch (error) {
    console.error('Error in AI chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/ai-chat/can-chat/:botId - Check if user can chat with bot
router.get('/can-chat/:botId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { botId } = req.params;
    const userId = req.user?.profileId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', canChat: false });
      return;
    }

    const now = new Date();
    
    // Find active session for this bot
    const activeSession = await prisma.aISession.findFirst({
      where: {
        profileId: userId,
        botId: parseInt(botId),
        isActive: true,
        endTime: { gt: now }
      }
    });

    res.json({ 
      canChat: !!activeSession,
      sessionId: activeSession?.id || null,
      endTime: activeSession?.endTime || null
    });
  } catch (error) {
    console.error('Error checking chat access:', error);
    res.status(500).json({ error: 'Internal server error', canChat: false });
  }
});

// GET /api/ai-chat/session/:sessionId/time-remaining - Get time remaining for session
router.get('/session/:sessionId/time-remaining', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.profileId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const session = await prisma.aISession.findFirst({
      where: {
        id: sessionId,
        profileId: userId,
        isActive: true
      }
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const now = new Date();
    const endTime = new Date(session.endTime);
    const msRemaining = endTime.getTime() - now.getTime();
    const minutesRemaining = Math.floor(msRemaining / 60000);
    const secondsRemaining = Math.floor((msRemaining % 60000) / 1000);

    res.json({
      endTime: session.endTime,
      msRemaining: Math.max(0, msRemaining),
      minutesRemaining: Math.max(0, minutesRemaining),
      secondsRemaining: Math.max(0, secondsRemaining),
      isExpired: msRemaining <= 0
    });
  } catch (error) {
    console.error('Error getting time remaining:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET route to fetch chat history
router.get('/:sessionId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.profileId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Verify session belongs to user
    const session = await prisma.aISession.findFirst({
      where: {
        id: sessionId,
        profileId: userId
      }
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Get chat messages
    const messages = await prisma.aIMsg.findMany({
      where: {
        sessionId,
        profileId: userId
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    res.json({ 
      session,
      messages 
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;