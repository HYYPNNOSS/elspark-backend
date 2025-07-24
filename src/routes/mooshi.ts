import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

interface UpdatePersonalityRequest {
  mooshiNumber: number;
  messages: string[];
}

interface PersonalityTraits {
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

// Modified personality generation for conversation-based updates
const updatePersonalityFromConversation = async (
  mooshi: any,
  conversation: GeneratedConversation,
  partnerPersonality: any
): Promise<PersonalityTraits> => {
  const existingPersonality = mooshi.personality || {};
  const conversationText = conversation.messages.join('\n');
  
  const prompt = `Update this Mooshi's personality based on their conversation:

Current personality: ${JSON.stringify(existingPersonality)}
Conversation: "${conversationText}"
Conversation partner's traits: ${JSON.stringify(partnerPersonality)}
Topic: ${conversation.topic}

Update the personality to reflect how this conversation might have influenced them. 
Consider: communication patterns, interests discovered, social adaptability, etc.
Return only a valid JSON object with updated personality traits.`;

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
    const personalityText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    let updatedPersonality: PersonalityTraits;
    try {
      const cleanText = personalityText.replace(/```json|```/g, '').trim();
      updatedPersonality = JSON.parse(cleanText);
    } catch (parseError) {
      updatedPersonality = {
        ...existingPersonality,
        last_interaction: conversation.topic,
        communication_adaptability: "improved"
      };
    }
    
    updatedPersonality.last_updated = new Date().toISOString();
    updatedPersonality.last_conversation_topic = conversation.topic;
    
    return updatedPersonality;
    
  } catch (error) {
    console.error('Error updating personality:', error);
    return {
      ...existingPersonality,
      last_updated: new Date().toISOString(),
      interaction_count: ((existingPersonality as any)?.interaction_count || 0) + 1
    };
  }
};

// Add this function to generate conversations between two Mooshis
const generateConversationBetweenMooshis = async (
  mooshi1: any, 
  mooshi2: any
): Promise<GeneratedConversation> => {
  const personality1 = mooshi1.personality || {};
  const personality2 = mooshi2.personality || {};
  
  const prompt = `Generate a 4-message conversation between two AI characters:
  
Character 1 (${mooshi1.username}): ${JSON.stringify(personality1)}
Character 2 (${mooshi2.username}): ${JSON.stringify(personality2)}

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
        personality: true
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

        const [updatedPersonality1, updatedPersonality2] = await Promise.all([
          updatePersonalityFromConversation(pair.mooshi1, conversation, pair.mooshi2.personality),
          updatePersonalityFromConversation(pair.mooshi2, conversation, pair.mooshi1.personality)
        ]);

        console.log(`✅ Updated personality for ${pair.mooshi1.username}:`, updatedPersonality1);
        console.log(`✅ Updated personality for ${pair.mooshi2.username}:`, updatedPersonality2);
        // Save updated personalities
        await Promise.all([
          prisma.user.update({
            where: { id: pair.mooshi1.id },
            data: { personality: updatedPersonality1 as any }
          }),
          prisma.user.update({
            where: { id: pair.mooshi2.id },
            data: { personality: updatedPersonality2 as any }
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
      personality: mooshi.personality,
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

const generatePersonality = async (
  messages: string[], 
  existingPersonality: any
): Promise<PersonalityTraits> => {
  const messagesText = messages.join('\n');
  const hasExisting = existingPersonality && typeof existingPersonality === 'object' && Object.keys(existingPersonality).length > 0;
  
  const prompt = hasExisting 
    ? `Based on these 10 messages: "${messagesText}", update this existing personality: ${JSON.stringify(existingPersonality)}. Return only a valid JSON object with personality traits like communication_style, interests, humor_level, empathy, etc.`
    : `Based on these 10 messages: "${messagesText}", create a JSON personality object for an AI character. Return only a valid JSON object with traits like communication_style, interests, humor_level, empathy, energy_level, etc.`;
  
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
    const personalityText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    let parsedPersonality: PersonalityTraits;
    try {
      
      const cleanText = personalityText.replace(/```json|```/g, '').trim();
      parsedPersonality = JSON.parse(cleanText);
    } catch (parseError) {
      console.error('Error parsing personality JSON:', parseError);
      parsedPersonality = {
        communication_style: "adaptive",
        generated_from: "fallback"
      };
    }
    
    parsedPersonality.last_updated = new Date().toISOString();
    return parsedPersonality;
    
  } catch (error) {
    console.error('Error generating personality:', error);
    return { 
      communication_style: "adaptive", 
      generated_from: "error_fallback",
      last_updated: new Date().toISOString()
    };
  }
};

router.post('/update-personality', async (req: Request, res: Response) => {
  try {
    const { mooshiNumber, messages }: UpdatePersonalityRequest = req.body;
    
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
    
    // Generate new personality based on messages
    const newPersonality = await generatePersonality(messages, mooshi.personality);
    
    // Update mooshi personality
    const updatedMooshi = await prisma.user.update({
      where: { id: mooshi.id },
      data: { 
        personality: newPersonality as any // Prisma Json type
      }
    });
    
    res.status(200).json({ 
      success: true, 
      personality: newPersonality,
      mooshiId: updatedMooshi.id 
    });
    
    
  } catch (error) {
    console.error('Error updating personality:', error);
    res.status(500).json({ error: 'Failed to update personality' });
    return;
  }
});

// Add this route to your existing router (add it before the export default router line)

router.get('/personality/:mooshiNumber', async (req: Request, res: Response) => {
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
        personality: true,
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
      personality: mooshi.personality || {}
    });
    
  } catch (error) {
    console.error('Error fetching mooshi personality:', error);
    res.status(500).json({ error: 'Failed to fetch mooshi personality' });
    return;
  }
});

export default router;