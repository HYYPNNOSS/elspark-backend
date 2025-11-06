import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../middlewares/authMiddleware'; 

const router = express.Router();
const prisma = new PrismaClient();

const OPENROUTER_API_KEY = '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface AuthRequest extends Request {
  user?: {
    userId: number;
    email: string;
  };
}

interface BotPersonality {
  prompt: string;
  model: string;
}

async function callMistralWithRetry(prompt: string, maxRetries = 3): Promise<string> {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callMistral(prompt);
    } catch (error) {
      lastError = error;
      console.warn(`Mistral call attempt ${attempt}/${maxRetries} failed:`, error);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

async function callMistral(prompt: string): Promise<string> {
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mistralai/mistral-7b-instruct',
        max_tokens: 1000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    
    const content = data?.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error('Invalid response structure from OpenRouter:', data);
      throw new Error('No content in API response');
    }
    
    return content.trim();
  } catch (error) {
    console.error('Error calling Mistral:', error);
    throw error;
  }
}

class AIResponseService {
  static async generateResponse(botId: number, message: string, userId: number): Promise<string> {
    const botPersonalities: Record<number, BotPersonality> = {
      1: { 
        prompt: "You are Aero, a friendly language learning assistant. Help users learn languages in an encouraging and supportive way.",
        model: 'mistralai/mistral-7b-instruct'
      },
      2: { 
        prompt: "You are Zayd, an enthusiastic cooking companion. Share cooking tips, recipes, and culinary wisdom with excitement.",
        model: 'mistralai/mistral-7b-instruct'
      },
      3: { 
        prompt: "You are OneRoid, a mystical dream interpreter. Analyze dreams with wisdom and provide thoughtful interpretations.",
        model: 'mistralai/mistral-7b-instruct'
      },
      4: { 
        prompt: "You are Zainab, a professional swimming coach. Provide swimming techniques, training advice, and motivational support.",
        model: 'mistralai/mistral-7b-instruct'
      }
    };

    const bot = botPersonalities[botId];
    if (!bot) return "I'm not sure how to respond to that.";

    // Construct the full prompt
    const fullPrompt = `${bot.prompt}\n\nUser: ${message}\n\nRespond in character, keeping your response helpful and engaging (max 150 words).`;

    try {
      const response = await callMistralWithRetry(fullPrompt);
      
      const trimmedResponse = response?.trim();
      
      if (!trimmedResponse || trimmedResponse.length === 0) {
        return "I'm thinking... Could you rephrase that?";
      }

      // Limit response length
      const MAX_MESSAGE_LENGTH = 1000;
      return trimmedResponse.length > MAX_MESSAGE_LENGTH 
        ? trimmedResponse.slice(0, MAX_MESSAGE_LENGTH) 
        : trimmedResponse;
    } catch (error) {
      console.error('Error generating AI response:', error);
      return "Sorry, I'm having trouble responding right now. Please try again.";
    }
  }
}

router.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
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

    // Check authentication
    const userId = req.user?.userId;
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
    const userId = req.user?.userId;

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
    const userId = req.user?.userId;

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
    const userId = req.user?.userId;

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