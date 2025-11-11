import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../middlewares/authMiddleware'; 

const router = express.Router();
const prisma = new PrismaClient();

const HUGGINGFACE_API_KEY = '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';

interface AuthRequest extends Request {
  user?: {
    profileId: number;
  };
}

interface BotPersonality {
  name: string;
  model: string;
  systemPrompt: string;
}

async function callHuggingFace(messages: any[], model: string) {
  const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 400,
      temperature: 0.7,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("HF API Error:", data);
    throw new Error(data.error?.message || "HF API call failed");
  }

  return data.choices?.[0]?.message?.content ?? "";
}

async function callHuggingFaceWithRetry(messages: any[], model: string) {
  for (let i = 1; i <= 3; i++) {
    try {
      return await callHuggingFace(messages, model);
    } catch (error) {
      console.log(`HuggingFace call attempt ${i}/3 failed:`, error);
      if (i === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

export class AIResponseService {
  static async generateResponse(
    botId: number,
    message: string,
    sessionId: string,
    userId: number
  ): Promise<string> {

    // ✅ Updated with WORKING models confirmed on HF Router
    const botPersonalities: Record<number, BotPersonality> = {
      1: {
        name: "French Teacher",
        model: "meta-llama/Llama-3.1-8B-Instruct",
        systemPrompt: `You are Aero, a French teacher and you are on ELSPARK. helping me learn french. Keep responses short and precise...`
      },
      2: {
        name: "Spanish Teacher",
        model: "Qwen/Qwen2.5-7B-Instruct",
        systemPrompt: `You are Misha, a Spanish teacher and you are on ELSPARK. helping me learn spanish. Keep responses short and precise...`
      },
      3: {
        name: "journal assistant",
        model: "Qwen/Qwen2.5-Coder-3B-Instruct",
        systemPrompt: `You are Packet, a journal assistant and you are on ELSPARK. helping me journal my day. Keep responses short and precise...`
      },
      4: {
        name: "Onerios dream analyzer",
        model: "deepseek-ai/DeepSeek-V3.2-Exp",
        systemPrompt: `You are Onerios, a dream analyzer and you are on ELSPARK. helping me analyze my dreams. Keep responses short and precise...`
      }
    };
    
    const bot = botPersonalities[botId];
    if (!bot) return "Unknown bot.";

    try {
      const history = await prisma.aIMsg.findMany({
        where: { sessionId, profileId: userId },
        orderBy: { createdAt: "asc" },
        take: 20
      });

      const messages: any[] = [
        {
          role: "system",
          content: `${bot.systemPrompt}

IMPORTANT RULES:
- Do NOT greet the user again if already talking
- Keep responses short (2–3 sentences unless needed)
- Build on previous messages
- Be conversational and natural`
        }
      ];

      history.forEach(msg => {
        messages.push({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.message
        });
      });

      messages.push({ role: "user", content: message });

      let text = await callHuggingFaceWithRetry(messages, bot.model);

      // cleanup
      text = text.replace(/^(Assistant|Aero|Zayed|Onerios):/i, "").trim();
      text = text.split("\n")[0].trim();

      const MAX_MESSAGE_LENGTH = 600;
      if (text.length > MAX_MESSAGE_LENGTH) {
        const cut = text.slice(0, MAX_MESSAGE_LENGTH);
        const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
        text = end > 0 ? cut.slice(0, end + 1) : cut + "...";
      }

      return text;
    } catch (error: any) {
      console.error("Error generating AI response:", error);
      return "Sorry, I'm having trouble responding. Try again.";
    }
  }
}

// ✅ Working models confirmed on HF Router (November 2025)
const SERVERLESS_MODELS = {
  "llama": "meta-llama/Llama-3.1-8B-Instruct",        // Fast, reliable for chat
  "qwen": "Qwen/Qwen2.5-7B-Instruct",                 // Excellent multilingual
  "qwen-coder": "Qwen/Qwen2.5-Coder-3B-Instruct",     // Good for creative tasks
  "deepseek": "deepseek-ai/DeepSeek-V3.2-Exp",        // Fast reasoning model
  "gpt-oss": "openai/gpt-oss-120b",                   // High performance open model
};

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