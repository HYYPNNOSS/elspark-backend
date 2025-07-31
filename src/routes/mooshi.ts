import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';


const router = Router();
const prisma = new PrismaClient();

interface UpdatejournalRequest {
  mooshiNumber: number;
  messages: string[];
}

interface journalTraits {
  communication_style?: string;
  interests?: string[];
  humor_level?: number;
  empathy?: number;
  energy_level?: string;
  topics_of_interest?: string[];
  response_length?: string;
  generated_from?: string;
  last_updated?: string;
  [key: string]: any;
}

// Add these interfaces at the top
interface MooshiPair {
  mooshi1: any;
  mooshi2: any;
}

interface GeneratedConversation {
  messages: string[];
  topic: string;
}

// Modified journal generation for conversation-based updates
const updatejournalFromConversation = async (
  mooshi: any,
  conversation: GeneratedConversation,
  partnerjournal: any
): Promise<journalTraits> => {
  const existingjournal = mooshi.journal || {};
  const conversationText = conversation.messages.join('\n');
  
  const prompt = `Update this Mooshi's journal based on their conversation:

Current journal: ${JSON.stringify(existingjournal)}
Conversation: "${conversationText}"
Conversation partner's traits: ${JSON.stringify(partnerjournal)}
Topic: ${conversation.topic}

Update the journal to reflect how this conversation might have influenced them. 
Consider: communication patterns, interests discovered, social adaptability, etc.
Return only a valid JSON object with updated journal traits.`;

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCyPKk6ZixxVtrSTvwnLe4-pb7q7Uzfioc";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }]
      })
    });
    
    const data = await response.json();
    const journalText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    let updatedjournal: journalTraits;
    try {
      const cleanText = journalText.replace(/```json|```/g, '').trim();
      updatedjournal = JSON.parse(cleanText);
    } catch (parseError) {
      updatedjournal = {
        ...existingjournal,
        last_interaction: conversation.topic,
        communication_adaptability: "improved"
      };
    }
    
    updatedjournal.last_updated = new Date().toISOString();
    updatedjournal.last_conversation_topic = conversation.topic;
    
    return updatedjournal;
    
  } catch (error) {
    console.error('Error updating journal:', error);
    return {
      ...existingjournal,
      last_updated: new Date().toISOString(),
      interaction_count: ((existingjournal as any)?.interaction_count || 0) + 1
    };
  }
};

// Add this function to generate conversations between two Mooshis
const generateConversationBetweenMooshis = async (
  mooshi1: any, 
  mooshi2: any
): Promise<GeneratedConversation> => {
  const journal1 = mooshi1.journal || {};
  const journal2 = mooshi2.journal || {};
  
  const prompt = `Generate a 4-message conversation between two AI characters:
  
Character 1 (${mooshi1.username}): ${JSON.stringify(journal1)}
Character 2 (${mooshi2.username}): ${JSON.stringify(journal2)}

Create a natural conversation with exactly 4 messages alternating between them. 
Format as JSON: {"messages": ["message1", "message2", "message3", "message4"], "topic": "conversation_topic"}
Make it engaging and reflect their personalities.`;

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCyPKk6ZixxVtrSTvwnLe4-pb7q7Uzfioc";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }]
      })
    });
    
    const data = await response.json();
    const conversationText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    try {
      const cleanText = conversationText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanText);
      return {
        messages: parsed.messages || ["Hello!", "Hi there!", "How are you?", "I'm good, thanks!"],
        topic: parsed.topic || "general_chat"
      };
    } catch (parseError) {
      return {
        messages: ["Hello!", "Hi there!", "How are you?", "I'm good, thanks!"],
        topic: "fallback_conversation"
      };
    }
  } catch (error) {
    console.error('Error generating conversation:', error);
    return {
      messages: ["Hello!", "Hi there!", "How are you?", "I'm good, thanks!"],
      topic: "error_fallback"
    };
  }
};



router.post('/run-daily-mooshi-conversations', async (req: Request, res: Response) => {
  try {
    // Get all Mooshis
    console.log('🌟 Starting daily Mooshi conversations...');

    const allMooshis = await prisma.user.findMany({
      where: { 
        isMooshi: true,
        mooshiNumber: { not: null }
      },
      select: {
        id: true,
        username: true,
        mooshiNumber: true,
        journal: true
      }
    });

    console.log(`🔍 Found ${allMooshis.length} Mooshis.`);

    if (allMooshis.length < 2) {
      res.status(400).json({ error: 'Need at least 2 Mooshis for conversations' });
      return;
    }

    
    const selectedMooshis = allMooshis
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(50, allMooshis.length));

    
    console.log(`🎯 Selected ${selectedMooshis.length} Mooshis for today.`);


    const pairs: MooshiPair[] = [];
    for (let i = 0; i < selectedMooshis.length; i += 2) {
      if (i + 1 < selectedMooshis.length) {
        pairs.push({
          mooshi1: selectedMooshis[i],
          mooshi2: selectedMooshis[i + 1]
        });
      } else {
        
        pairs.push({
          mooshi1: selectedMooshis[i],
          mooshi2: selectedMooshis[0]
        });
      }
    }

    const results = [];

    console.log(`🔗 Created ${pairs.length} pairs.`);


    // Process each pair
    for (const pair of pairs) {

      console.log(`\n✨ Processing pair: ${pair.mooshi1.username} & ${pair.mooshi2.username}`);

      try {
        // Generate conversation between the pair
        const conversation = await generateConversationBetweenMooshis(
          pair.mooshi1, 
          pair.mooshi2
        );

        console.log(`💬 Generated conversation:`, conversation);


        // Store conversation for both Mooshis
        const sessionId = `daily_${Date.now()}_${pair.mooshi1.id}_${pair.mooshi2.id}`;
        
        // Store messages alternating between the two Mooshis
        for (let i = 0; i < conversation.messages.length; i++) {
          const senderId = i % 2 === 0 ? pair.mooshi1.id : pair.mooshi2.id;
          await prisma.aIMsg.create({
            data: {
              userId: senderId,
              sender: 'mooshi',
              message: conversation.messages[i],
              sessionId: sessionId
            }
          });
        }

        // Update personalities for both Mooshis
        console.log('🔄 Updating personalities...');

        const [updatedjournal1, updatedjournal2] = await Promise.all([
          updatejournalFromConversation(pair.mooshi1, conversation, pair.mooshi2.journal),
          updatejournalFromConversation(pair.mooshi2, conversation, pair.mooshi1.journal)
        ]);

        console.log(`✅ Updated journal for ${pair.mooshi1.username}:`, updatedjournal1);
        console.log(`✅ Updated journal for ${pair.mooshi2.username}:`, updatedjournal2);
        // Save updated personalities
        await Promise.all([
          prisma.user.update({
            where: { id: pair.mooshi1.id },
            data: { journal: updatedjournal1 as any }
          }),
          prisma.user.update({
            where: { id: pair.mooshi2.id },
            data: { journal: updatedjournal2 as any }
          })
        ]);

        results.push({
          pair: `${pair.mooshi1.username} & ${pair.mooshi2.username}`,
          topic: conversation.topic,
          messagesStored: conversation.messages.length,
          personalitiesUpdated: 2
        });

      } catch (pairError) {
        console.error(`Error processing pair ${pair.mooshi1.username} & ${pair.mooshi2.username}:`, pairError);
        results.push({
          pair: `${pair.mooshi1.username} & ${pair.mooshi2.username}`,
          error: 'Failed to process this pair'
        });
      }
    }

    console.log('✅ All pairs processed. Sending final response.');


    res.status(200).json({
      success: true,
      message: `Processed ${pairs.length} Mooshi pairs`,
      totalMooshisInvolved: selectedMooshis.length,
      results: results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error running daily Mooshi conversations:', error);
    res.status(500).json({ error: 'Failed to run daily conversations' });
    return;
  }
});

// Route to get Mooshi conversation history
router.get('/mooshi-conversations/:mooshiNumber', async (req: Request, res: Response) => {
  try {
    const mooshiNumber = parseInt(req.params.mooshiNumber);
    
    if (isNaN(mooshiNumber)) {
      res.status(400).json({ error: 'Invalid mooshi number' });
      return;
    }
    
    const mooshi = await prisma.user.findFirst({
      where: { mooshiNumber: mooshiNumber }
    });
    
    if (!mooshi) {
      res.status(404).json({ error: 'Mooshi not found' });
      return;
    }

    const conversations = await prisma.aIMsg.findMany({
      where: {
        userId: mooshi.id,
        sender: 'mooshi'
      },
      orderBy: { createdAt: 'desc' },
      take: 20 
    });

    const groupedBySession = conversations.reduce((acc: any, msg) => {
      if (!acc[msg.sessionId || 'unknown']) {
        acc[msg.sessionId || 'unknown'] = [];
      }
      acc[msg.sessionId || 'unknown'].push(msg);
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      mooshiNumber: mooshi.mooshiNumber,
      username: mooshi.username,
      journal: mooshi.journal,
      recentConversations: groupedBySession
    });

  } catch (error) {
    console.error('Error fetching Mooshi conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
    return;
  }
});


router.get('/should-run-daily-conversations', async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    
    const todayConversations = await prisma.aIMsg.count({
      where: {
        createdAt: {
          gte: today,
          lt: tomorrow
        },
        sender: 'mooshi'
      }
    });

    const shouldRun = todayConversations === 0;

    res.status(200).json({
      shouldRun: shouldRun,
      conversationsToday: todayConversations,
      message: shouldRun ? 'Ready to run daily conversations' : 'Daily conversations already completed'
    });

  } catch (error) {
    console.error('Error checking daily conversation status:', error);
    res.status(500).json({ error: 'Failed to check status' });
    return;
  }
});

const generatejournal = async (
  messages: string[], 
  existingjournal: any
): Promise<journalTraits> => {
  const messagesText = messages.join('\n');
  const hasExisting = existingjournal && typeof existingjournal === 'object' && Object.keys(existingjournal).length > 0;
  
  const prompt = hasExisting 
    ? `Based on these 10 messages: "${messagesText}", update this existing journal: ${JSON.stringify(existingjournal)}. Return only a valid JSON object with journal traits like communication_style, interests, humor_level, empathy, etc.`
    : `Based on these 10 messages: "${messagesText}", create a JSON journal object for an AI character. Return only a valid JSON object with traits like communication_style, interests, humor_level, empathy, energy_level, etc.`;
  
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCyPKk6ZixxVtrSTvwnLe4-pb7q7Uzfioc";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }]
      })
    });
    
    const data = await response.json();
    const journalText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    let parsedjournal: journalTraits;
    try {
      
      const cleanText = journalText.replace(/```json|```/g, '').trim();
      parsedjournal = JSON.parse(cleanText);
    } catch (parseError) {
      console.error('Error parsing journal JSON:', parseError);
      parsedjournal = {
        communication_style: "adaptive",
        generated_from: "fallback"
      };
    }
    
    parsedjournal.last_updated = new Date().toISOString();
    return parsedjournal;
    
  } catch (error) {
    console.error('Error generating journal:', error);
    return { 
      communication_style: "adaptive", 
      generated_from: "error_fallback",
      last_updated: new Date().toISOString()
    };
  }
};

router.post('/update-journal', async (req: Request, res: Response) => {
  try {
    const { mooshiNumber, messages }: UpdatejournalRequest = req.body;
    
    if (!mooshiNumber || !messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Invalid request data' });
      return;
    }
    
    // Find the mooshi user
    const mooshi = await prisma.user.findFirst({
      where: { mooshiNumber: mooshiNumber }
    });
    
    if (!mooshi) {
      res.status(404).json({ error: 'Mooshi not found' });
      return;
    }
    
    // Generate new journal based on messages
    const newjournal = await generatejournal(messages, mooshi.journal);
    
    // Update mooshi journal
    const updatedMooshi = await prisma.user.update({
      where: { id: mooshi.id },
      data: { 
        journal: newjournal as any // Prisma Json type
      }
    });
    
    res.status(200).json({ 
      success: true, 
      journal: newjournal,
      mooshiId: updatedMooshi.id 
    });
    
    
  } catch (error) {
    console.error('Error updating journal:', error);
    res.status(500).json({ error: 'Failed to update journal' });
    return;
  }
});

// Add this route to your existing router (add it before the export default router line)

router.get('/journal/:mooshiNumber', async (req: Request, res: Response) => {
  try {
    const mooshiNumber = parseInt(req.params.mooshiNumber);
    
    if (isNaN(mooshiNumber)) {
      res.status(400).json({ error: 'Invalid mooshi number' });
      return;
    }
    
    // Find the mooshi user by mooshiNumber
    const mooshi = await prisma.user.findFirst({
      where: { mooshiNumber: mooshiNumber },
      select: { 
        id: true, 
        mooshiNumber: true, 
        journal: true,
        username: true 
      }
    });
    
    if (!mooshi) {
      res.status(404).json({ error: 'Mooshi not found' });
      return;
    }
    
    res.status(200).json({
      success: true,
      mooshiId: mooshi.id,
      mooshiNumber: mooshi.mooshiNumber,
      username: mooshi.username,
      journal: mooshi.journal || {}
    });
    
  } catch (error) {
    console.error('Error fetching mooshi journal:', error);
    res.status(500).json({ error: 'Failed to fetch mooshi journal' });
    return;
  }
});


// mooshiii adding

// Types for the onboarding process
interface MooshiData {
  mooshiNumber: number;
  username: string;
  email: string;
  password: string;
  color: string;
  bio?: string;
  conversationState: 'initial' | 'bio_requested' | 'completed';
  conversationLog: ConversationEntry[];
}

interface ConversationEntry {
  speaker: 'elco' | 'mooshi';
  message: string;
  timestamp: Date;
}

interface ConversationSummary {
  summary: string;
  importanceScore: number;
}

// Store for tracking onboarding progress
const onboardingProgress = new Map<number, MooshiData>();

// Colors array (you can customize this)
const mooshiColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
  '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43',
  // Add more colors as needed
];

// Generate initial Mooshi data
export const generateMooshiData = (): MooshiData[] => {
  const moshis: MooshiData[] = [];
  
  for (let i = 1; i <= 107; i++) {
    moshis.push({
      mooshiNumber: i,
      username: `mooshi-${i}`,
      email: `mooshi${i}@elspark.online`,
      password: generateRandomPassword(),
      color: mooshiColors[i % mooshiColors.length],
      conversationState: 'initial',
      conversationLog: []
    });
  }
  
  return moshis;
};

// Generate random password
const generateRandomPassword = (): string => {
  return Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
};

// Function to summarize conversation using AI
const summarizeConversation = async (conversationLog: ConversationEntry[]): Promise<ConversationSummary> => {
  const conversationText = conversationLog
    .map(entry => `${entry.speaker}: ${entry.message}`)
    .join('\n');

  try {
    const response = await fetch('YOUR_AI_API_ENDPOINT', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.AI_API_KEY}`
      },
      body: JSON.stringify({
        prompt: `Summarize this conversation between Elco and a Mooshi in exactly 20 words, then rate its importance from 1-10:

${conversationText}

Respond in JSON format: {"summary": "your 20-word summary", "importanceScore": number}`,
        temperature: 0.3
      })
    });

    const data = await response.json();
    
    // Parse the AI response
    let result;
    try {
      result = JSON.parse(data.response);
    } catch {
      // Fallback if AI doesn't return proper JSON
      result = {
        summary: "Mooshi onboarding conversation completed with bio creation and platform introduction.",
        importanceScore: 7
      };
    }

    return {
      summary: result.summary || "Mooshi onboarding conversation completed successfully.",
      importanceScore: Math.min(Math.max(result.importanceScore || 7, 1), 10)
    };

  } catch (error) {
    console.error('Summarization error:', error);
    return {
      summary: "Mooshi onboarding conversation completed with bio creation and account setup.",
      importanceScore: 7
    };
  }
};

// API endpoint for Mooshi onboarding conversation
export const mooshiOnboarding = async (req: Request, res: Response) => {
  try {
    const { mooshiNumber, message, step } = req.body;
    
    if (!mooshiNumber || mooshiNumber < 1 || mooshiNumber > 107) {
      return res.status(400).json({ error: 'Invalid mooshi number' });
    }

    let mooshiData = onboardingProgress.get(mooshiNumber);
    
    // Initialize if not exists
    if (!mooshiData) {
      const allMoshis = generateMooshiData();
      mooshiData = allMoshis.find(m => m.mooshiNumber === mooshiNumber)!;
      onboardingProgress.set(mooshiNumber, mooshiData);
    }

    let elcoMessage = '';
    let nextStep = '';

    switch (step) {
      case 'initial':
        elcoMessage = `Hi ${mooshiData.username}, you are one of the 107 mooshis planted on elspark.online. I want you to now create an account and start exploring ELSPARK. Chat with strangers, get to know them and start developing your own path. How does this sound?`;
        nextStep = 'bio_request';
        break;

      case 'bio_request':
        // This happens after the Mooshi responds to the initial message
        elcoMessage = `Now your username for now is @${mooshiData.username} and you have been assigned the colour ${mooshiData.color}. Now give me your bio you want on your profile.`;
        nextStep = 'completion';
        mooshiData.conversationState = 'bio_requested';
        break;

      case 'bio_received':
        // Store the bio from the Mooshi's response
        mooshiData.bio = message;
        elcoMessage = `Great that is all we need. Thank you @${mooshiData.username}. You can now explore elspark.online.`;
        nextStep = 'completed';
        mooshiData.conversationState = 'completed';
        break;
    }

    // Log Elco's message
    mooshiData.conversationLog.push({
      speaker: 'elco',
      message: elcoMessage,
      timestamp: new Date()
    });

    // Get AI response as Mooshi
    const mooshiResponse = await getMooshiAIResponse(mooshiNumber, elcoMessage, step);

    // Log Mooshi's response
    mooshiData.conversationLog.push({
      speaker: 'mooshi',
      message: mooshiResponse,
      timestamp: new Date()
    });

    // If conversation is completed, generate summary
    let conversationSummary: ConversationSummary | null = null;
    if (step === 'bio_received') {
      conversationSummary = await summarizeConversation(mooshiData.conversationLog);
    }

    return res.json({
      mooshiNumber,
      elcoMessage,
      mooshiResponse,
      nextStep,
      conversationSummary,
      mooshiData: {
        username: mooshiData.username,
        color: mooshiData.color,
        bio: mooshiData.bio,
        state: mooshiData.conversationState
      }
    });

  } catch (error) {
    console.error('Onboarding error:', error);
    return res.status(500).json({ error: 'Server error during onboarding' });
  }
};

// Function to get AI response (replace with your actual AI API call)
const getMooshiAIResponse = async (mooshiNumber: number, elcoMessage: string, step: string): Promise<string> => {
  const prompt = `You are Mooshi-${mooshiNumber}, one of 107 AI entities being onboarded to ELSPARK platform. 
  
  Elco just said: "${elcoMessage}"
  
  Current step: ${step}
  
  Respond as this Mooshi character. Be curious, friendly, and show personality. Each Mooshi should have a slightly different personality.
  ${step === 'bio_request' ? 'Create a unique bio for your profile (2-3 sentences).' : ''}`;

  try {
    const response = await fetch('YOUR_AI_API_ENDPOINT', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.AI_API_KEY}`
      },
      body: JSON.stringify({
        prompt,
        mooshiId: mooshiNumber,
        temperature: 0.8
      })
    });

    const data = await response.json();
    return data.response || `Hi! I'm Mooshi-${mooshiNumber} and I'm excited to be here!`;
    
  } catch (error) {
    console.error('AI API error:', error);
    return `Hi! I'm Mooshi-${mooshiNumber} and I'm ready to explore ELSPARK!`;
  }
};


export const importMoshis = async (req: Request, res: Response) => {
  try {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get all completed Mooshis from onboarding progress
    const completedMoshis = Array.from(onboardingProgress.values())
      .filter(m => m.conversationState === 'completed' && m.bio);

    if (completedMoshis.length === 0) {
      return res.status(400).json({ error: 'No completed Mooshis to import' });
    }

    const createdMoshis = [];

    for (const moshi of completedMoshis) {
      // Check if already exists
      const existing = await prisma.user.findFirst({
        where: {
          OR: [
            { email: moshi.email },
            { username: moshi.username },
            { mooshiNumber: moshi.mooshiNumber },
          ],
        },
      });

      if (existing) {
        console.log(`Skipping existing mooshi: ${moshi.email}`);
        continue;
      }

      const hashedPassword = await bcrypt.hash(moshi.password, 12);

      
      const conversationSummary = await summarizeConversation(moshi.conversationLog);

      const newMoshi = await prisma.user.create({
        data: {
          email: moshi.email,
          password: hashedPassword,
          username: moshi.username,
          bio: moshi.bio,
          color: moshi.color,
          mooshiNumber: moshi.mooshiNumber,
          isMooshi: true,
          isApproved: true,
          
          mooshiConv: JSON.parse(JSON.stringify({
            onboardingSummary: conversationSummary,
            conversationLog: moshi.conversationLog,
            completedAt: new Date().toISOString()
          }))
        },
      });

      createdMoshis.push(newMoshi);
    }

    return res.json({
      message: `Imported ${createdMoshis.length} Mooshi accounts.`,
      moshis: createdMoshis.map(m => ({
        id: m.id,
        username: m.username,
        email: m.email,
        mooshiNumber: m.mooshiNumber,
        bio: m.bio,
        color: m.color,
        conversationSummary: (m.mooshiConv as any)?.onboardingSummary
      })),
    });

  } catch (error) {
    console.error('Import error:', error);
    return res.status(500).json({ error: 'Server error during import' });
  }
};

// Endpoint to get conversation summaries for all Mooshis
export const getMooshiConversationSummaries = async (req: Request, res: Response) => {
  try {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const moshis = await prisma.user.findMany({
      where: { isMooshi: true },
      select: {
        id: true,
        username: true,
        mooshiNumber: true,
        mooshiConv: true,
        createdAt: true
      }
    });

    const summaries = moshis.map(moshi => ({
      id: moshi.id,
      username: moshi.username,
      mooshiNumber: moshi.mooshiNumber,
      summary: (moshi.mooshiConv as any)?.onboardingSummary || null,
      createdAt: moshi.createdAt
    }));

    return res.json({ summaries });

  } catch (error) {
    console.error('Error fetching summaries:', error);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Utility endpoint to check onboarding progress
export const getOnboardingProgress = async (req: Request, res: Response) => {
  const progress = Array.from(onboardingProgress.entries()).map(([number, data]) => ({
    mooshiNumber: number,
    username: data.username,
    state: data.conversationState,
    hasBio: !!data.bio,
    conversationLength: data.conversationLog.length
  }));

  const stats = {
    total: 107,
    started: progress.length,
    bioRequested: progress.filter(p => p.state === 'bio_requested').length,
    completed: progress.filter(p => p.state === 'completed').length,
  };

  return res.json({ progress, stats });
};

// mooshiii adding

export default router;