import express, { Request, Response } from 'express';
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

interface BotPersonality {
  prompt: string;
  responses: string[];
}

class AIResponseService {
  static async generateResponse(botId: number, message: string, userId: number): Promise<string> {
    const botPersonalities: Record<number, BotPersonality> = {
      1: { prompt: "You are Aero, a friendly language learning assistant.", responses: [] },
      2: { prompt: "You are Zayd, an enthusiastic cooking companion.", responses: [] },
      3: { prompt: "You are OneRoid, a mystical dream interpreter.", responses: [] },
      4: { prompt: "You are Zainab, a professional swimming coach.", responses: [] }
    };

    const bot = botPersonalities[botId];
    if (!bot) return "I'm not sure how to respond to that.";

    // ✅ Call Gemini
    const GEMINI_API_KEY = "AIzaSyCyPKk6ZixxVtrSTvwnLe4-pb7q7Uzfioc";
    // const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=" + GEMINI_API_KEY;

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
return text || "Sorry, I couldn't think of anything to say.";
const MAX_MESSAGE_LENGTH = 1000; // adjust to your DB column max length
const trimmedText = text.length > MAX_MESSAGE_LENGTH ? text.slice(0, MAX_MESSAGE_LENGTH) : text;

return trimmedText;

  }
}


router.post('/', aiMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId, message, botId }: { 
      sessionId: string; 
      message: string; 
      botId: number; 
    } = req.body;

    // Validate request body
    if (!sessionId || !message || !botId) {
      console.log(res.status(400).json({ error: 'Missing required fields: sessionId, message, botId' }))
      return
    }

    // Check authentication
    const userId = req.user?.userId;
    if (!userId) {
      console.log(res.status(401).json({ error: 'User not authenticated' }))
      return

    }

    // Verify session is active
    const session = await prisma.aISession.findFirst({
      where: {
        id: sessionId,
        profileId : userId,
        isActive: true,
        endTime: { gt: new Date() }
      }
    });

    if (!session) {
      console.log(res.status(400).json({ error: 'Session expired or invalid' }))
      return

    }

    // Store user message
    await prisma.aIMsg.create({
      data: {
        profileId : userId,
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

// GET route to fetch chat history
router.get('/:sessionId', aiMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      console.log(res.status(401).json({ error: 'User not authenticated' }))
      return

    }

    // Verify session belongs to user
    const session = await prisma.aISession.findFirst({
      where: {
        id: sessionId,
        profileId : userId
      }
    });

    if (!session) {
      
      console.log(res.status(404).json({ error: 'Session not found' }))
      
      return

    }

    // Get chat messages
    const messages = await prisma.aIMsg.findMany({
      where: {
        sessionId,
        profileId : userId
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