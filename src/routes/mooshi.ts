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

    const fullPrompt = `${bot.prompt}\n\nUser: ${message}\n\nRespond in character, keeping your response helpful and engaging (max 150 words).`;

    try {
      const response = await callMistralWithRetry(fullPrompt);
      
      const trimmedResponse = response?.trim();
      
      if (!trimmedResponse || trimmedResponse.length === 0) {
        return "I'm thinking... Could you rephrase that?";
      }

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

    if (!sessionId || !message || !botId) {
      res.status(400).json({ error: 'Missing required fields: sessionId, message, botId' });
      return;
    }

    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

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

    await prisma.aIMsg.create({
      data: {
        profileId: userId,
        sender: 'user',
        message,
        sessionId
      }
    });

    const aiResponse = await AIResponseService.generateResponse(botId, message, userId);

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

router.get('/can-chat/:botId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { botId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', canChat: false });
      return;
    }

    const now = new Date();
    
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



router.post('/respond', async (req: Request, res: Response) => {
  try {
    const { mooshiNumber, username, userMessage, chatHistory } = req.body;

    if (!mooshiNumber || !userMessage) {
      res.status(400).json({ error: 'Missing required fields' });
      return; 
    }

    
    const mooshi = await prisma.profile.findFirst({
      where: { mooshiNumber: mooshiNumber }
    });

    if (!mooshi) {
      res.status(404).json({ error: 'Mooshi not found' });
      return;
    }

    const journalEntries = mooshi.journal 
      ? (mooshi.journal as any[]).slice(-4)
      : [];

    let prompt = `You are mooshi-${mooshiNumber}, a friendly AI entity on ELSPARK. 
Your color is ${mooshi.color}.
Your bio: ${mooshi.bio}

Recent journal entries:
${journalEntries.map((j: any) => `- ${j.entry}`).join('\n')}

Chat history:
${chatHistory || 'No previous messages'}

${username} just said: "${userMessage}"

Respond naturally as mooshi-${mooshiNumber}. Keep it SHORT (1-2 sentences). Be casual and friendly. NO markdown, NO special formatting, NO asterisks.

Your response:`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'mistralai/mistral-7b-instruct',
        max_tokens: 150,
        temperature: 0.8,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('OpenRouter API error:', response.status);
      res.status(500).json({ 
        error: 'AI service error',
        response: "Sorry, I'm having trouble thinking right now..."
      });
      return;
    }

    const data = await response.json();
    
    let aiResponse = data?.choices?.[0]?.message?.content?.trim() || '';
    
    aiResponse = aiResponse
      .replace(/<s>/g, '')
      .replace(/<\/s>/g, '')
      .replace(/<\|user\|>/g, '')
      .replace(/<\|assistant\|>/g, '')
      .replace(/\*\*/g, '')
      .replace(/Your response:/gi, '')
      .replace(/mooshi-\d+:/gi, '')
      .trim();

    if (!aiResponse || aiResponse.length === 0) {
      aiResponse = "...";
    }

    if (aiResponse.length > 500) {
      aiResponse = aiResponse.substring(0, 500);
    }

    console.log(`Mooshi ${mooshiNumber} responding:`, aiResponse);

    res.json({ response: aiResponse });

  } catch (error) {
    console.error('Error in mooshi respond:', error);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal error',
        response: "Hmm, I'm having trouble responding..."
      });
    }
  }
});

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

router.get('/:sessionId', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
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
      return;
    }

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

router.post('/create-all-mooshis', async (req: Request, res: Response) => {
  try {
    const results = {
      successful: [],
      failed: []
    };

    for (let mooshiNumber = 1; mooshiNumber <= 107; mooshiNumber++) {
      try {
        const colorMap = ['red', 'blue', 'green', 'blue'];
        const color = colorMap[mooshiNumber % 4];

        const existing = await prisma.profile.findFirst({
          where: { mooshiNumber }
        });
        
        if (existing) {
          (results.failed as { mooshiNumber: number; reason: string }[]).push({ mooshiNumber, reason: 'Already exists' });
          continue;
        }

        const creationPrompt = `Elco: "Hi mooshi-${mooshiNumber}, you are one of the 107 mooshis planted on elspark.online.

I want you to now create an account and start exploring ELSPARK. Chat with strangers, get to know them and start developing your own path.

How does this sound?

Mooshi:`;

        const initialResponse = await callMistral(creationPrompt);

        const bioPrompt = `Elco:"Now your username for now is @mooshi-${mooshiNumber} and you have been assigned the colour ${color}. Now give me your bio you want on your profile.

Mooshi:`;

        const bio = await callMistral(bioPrompt);

        const initialJournalEntry = {
          entry: `I was created as mooshi-${mooshiNumber}. Elco greeted me, gave me the color ${color}, and asked me to explore ELSPARK and meet others. Excited to start chatting and see what I can do!`,
          timestamp: new Date().toISOString(),
          conversationCount: 0
        };

const account = await prisma.account.create({
  data: {
    email: `mooshi${mooshiNumber}@elspark.internal`,
    password: 'N/A',
    cyberCoins: 5
  }
});

await prisma.profile.create({
  data: {
    accountId: account.id,
    username: `mooshi-${mooshiNumber}`,
    bio: bio.trim().substring(0, 190),
    color,
    isMooshi: true,
    isApproved: true,
    mooshiNumber,
    journal: [initialJournalEntry],
    mooshiConv: [],
    isActive: true
  }
});

        (results.successful as number[]).push(mooshiNumber);
        console.log(`✅ Successfully created mooshi-${mooshiNumber}`); 

      } catch (error) {
        console.error(`Error creating mooshi-${mooshiNumber}:`, error);
        (results.failed as { mooshiNumber: number; error: string }[]).push({ mooshiNumber, error: String(error) });
      }
    }

    res.json({
      success: true,
      message: `Created ${results.successful.length} Mooshis`,
      results
    });

  } catch (error) {
    console.error('Error in batch mooshi creation:', error);
    res.status(500).json({ error: 'Batch creation failed' });
  }
});


export default router;