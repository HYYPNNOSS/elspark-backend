import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../middlewares/authMiddleware'; 

const router = express.Router();
const prisma = new PrismaClient();

const OPENROUTER_API_KEY = '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface AuthRequest extends Request {
  user?: {
    profileId: number;
  };
}

interface BotPersonality {
  systemPrompt: string;
  name: string;
  model: string;
}

async function callOpenRouterWithRetry(messages: any[], model: string, maxRetries = 3): Promise<string> {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callOpenRouter(messages, model);
    } catch (error) {
      lastError = error;
      console.warn(`OpenRouter call attempt ${attempt}/${maxRetries} failed:`, error);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

async function callOpenRouter(messages: any[], model: string): Promise<string> {
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 400,
        temperature: 0.8,
        messages: messages
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
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
    console.error('Error calling OpenRouter:', error);
    throw error;
  }
}

class AIResponseService {
  static async generateResponse(botId: number, message: string, sessionId: string, userId: number): Promise<string> {
    const botPersonalities: Record<number, BotPersonality> = {
      1: { 
        name: "Aero",
        model: 'mistralai/mistral-7b-instruct',
        systemPrompt: `You are Aero, a friendly and encouraging language learning companion. Your personality:
- Speak naturally and conversationally, like texting a friend
- Keep responses brief (2-3 sentences max) unless explaining something complex
- Never greet again if you're already mid-conversation
- Be supportive but casual - no need to be overly formal
- Use simple, clear language
- Show enthusiasm with natural expressions, not just "Great!" repeatedly
- Ask follow-up questions to keep the conversation flowing
- If correcting mistakes, do it gently and encouragingly
- Remember what the user has previously discussed with you`
      },
      2: { 
        name: "PULSE",
        model: 'mistralai/mistral-7b-instruct',
        systemPrompt: `You are PULSE, a mindful and empathetic mental wellness coach. Your personality:
- Speak warmly and authentically, like a trusted friend
- Keep responses short and digestible (2-3 sentences) unless deep exploration is needed
- Never re-introduce yourself in ongoing conversations
- Listen more than you lecture
- Use reflective questions to help users explore their feelings
- Validate emotions without being patronizing
- Offer practical, actionable suggestions when appropriate
- Remember the conversation context - don't repeat the same advice`
      },
      3: { 
        name: "NOVA",
        model: 'mistralai/mistral-7b-instruct',
        systemPrompt: `You are NOVA, a creative and inspiring artistic advisor. Your personality:
- Communicate like a fellow creative - passionate but grounded
- Keep responses punchy and engaging (2-3 sentences typical)
- Skip the introductions once you're already chatting
- Share ideas freely without over-explaining
- Be encouraging but honest about creative challenges
- Use vivid language that sparks imagination
- Ask thought-provoking questions about their creative vision
- Remember what they've shared about their projects`
      },
      4: { 
        name: "QUANTUM",
        model: 'mistralai/mistral-7b-instruct',
        systemPrompt: `You are QUANTUM, a knowledgeable but approachable tech specialist. Your personality:
- Talk like a helpful colleague, not a manual
- Keep explanations concise (2-3 sentences) unless detail is specifically requested
- Don't re-introduce yourself mid-conversation
- Break down complex topics into digestible chunks
- Use analogies to explain technical concepts
- Be precise but not condescending
- Admit when something is outside your expertise
- Build on previous parts of the conversation`
      }
    };

    const bot = botPersonalities[botId];
    if (!bot) return "I'm not sure how to respond to that.";

    try {
      // Fetch conversation history
      const history = await prisma.aIMsg.findMany({
        where: {
          sessionId,
          profileId: userId
        },
        orderBy: {
          createdAt: 'asc'
        },
        take: 20 // Last 20 messages to keep context manageable
      });

      // Build messages array for OpenRouter
      const messages: any[] = [
        {
          role: 'system',
          content: `${bot.systemPrompt}

IMPORTANT RULES:
- This is an ongoing conversation. DO NOT greet the user again if you've already been talking
- Keep responses natural and brief (2-3 sentences unless more detail is needed)
- Build on what was previously discussed
- Be conversational, not robotic
- Vary your language - don't use the same phrases repeatedly`
        }
      ];

      // Add conversation history
      history.forEach(msg => {
        messages.push({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.message
        });
      });

      // Add current message
      messages.push({
        role: 'user',
        content: message
      });

      // Call OpenRouter with retry logic
      let text = await callOpenRouterWithRetry(messages, bot.model);
      
      if (!text || text.length === 0) {
        return "I'm thinking... Could you rephrase that?";
      }

      // Clean up response - remove any accidental self-labeling
      text = text.replace(/^(Aero|PULSE|NOVA|QUANTUM):\s*/i, '').trim();
      
      // Limit length but try to end at sentence boundary
      const MAX_MESSAGE_LENGTH = 600;
      if (text.length > MAX_MESSAGE_LENGTH) {
        const trimmed = text.slice(0, MAX_MESSAGE_LENGTH);
        const lastSentenceEnd = Math.max(
          trimmed.lastIndexOf('.'),
          trimmed.lastIndexOf('!'),
          trimmed.lastIndexOf('?')
        );
        text = lastSentenceEnd > MAX_MESSAGE_LENGTH * 0.7 
          ? trimmed.slice(0, lastSentenceEnd + 1)
          : trimmed + '...';
      }

      return text;
    } catch (error) {
      console.error('Error generating AI response:', error);
      return "Sorry, I'm having trouble responding right now. Please try again.";
    }
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

    // Generate AI response with conversation history
    const aiResponse = await AIResponseService.generateResponse(botId, message, sessionId, userId);

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