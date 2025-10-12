// routes/mooshi.ts
import express, { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router: Router = express.Router();
const prisma = new PrismaClient();

const OPENROUTER_API_KEY = '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
        temperature: 0.7, // Add temperature for more varied responses
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
    
    // ✅ VALIDATE RESPONSE STRUCTURE
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

// In mooshi.ts - Update the /respond route
router.post('/respond', async (req: Request, res: Response) => {
  try {
    const { mooshiNumber, username, userMessage, chatHistory } = req.body;

    // Get mooshi data
    const mooshi = await prisma.user.findUnique({
      where: { mooshiNumber: mooshiNumber }
    });

    if (!mooshi || !mooshi.isMooshi) {
      res.status(404).json({ error: 'Mooshi not found' });
      return;
    }

    // Get last 4 journal entries (B)
    const journal = mooshi.journal || [];
    const lastFourEntries = Array.isArray(journal) ? journal.slice(-4) : [];

    // Construct prompt
    const prompt = `
    Roleplay as mooshi-${mooshiNumber}an autonomous digital visitor of ELSPARK, existing solely on this digital park. You can only converse with strangers on the Social Labyrinth and learn about the world through them.

    You received a new message from user ${username},Reply to this message "${userMessage}" without breaking out of character in under 150 tokens, keeping the conversation engaging.

    ${chatHistory && chatHistory.trim() ? `Here's the chat history: ${chatHistory}` : ''} 
    ${lastFourEntries && lastFourEntries.length > 0 ? `Here are your last four personal journal entries which summarises your recent memory:\n${JSON.stringify(lastFourEntries)}.` : ''}
`;

  const response = await callMistralWithRetry(prompt);
    
    // ✅ VALIDATE RESPONSE - Don't send empty responses
    const trimmedResponse = response?.trim();
    
    if (!trimmedResponse || trimmedResponse.length === 0) {
      console.warn(`Empty response from Mistral for mooshi-${mooshiNumber}`);
      res.json({ 
        response: "..." 
      });
      return;
    }

    res.json({ response: trimmedResponse });
  } catch (error) {
    console.error('Error in mooshi response after retries:', error);
    res.status(500).json({ 
      error: 'Failed to generate response after multiple attempts',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Call 3: Summarise conversation
router.post('/summarize-conversation', async (req: Request, res: Response) => {
    try {
      const { mooshiNumber, conversation } = req.body;
  
      // Get last 1800 tokens of conversation (simplified - you may want token counting)
      const conversationText = conversation.slice(-1800);
  
      const prompt = `Elco: "mooshi-${mooshiNumber} just finished a conversation with userA.
  
Here's the chat ${conversationText}.
  
Roleplaying as mooshi-${mooshiNumber}, summarise what you retain from it in your own 20 words"
  
Mooshi:`;
  
      const summary = await callMistral(prompt);
  
      // Store summary in mooshiConv
      const mooshi = await prisma.user.findUnique({
        where: { mooshiNumber }
      });

      if (!mooshi) {
        res.status(404).json({ error: 'Mooshi not found' });
        return;
      }
  
      const conversations = mooshi.mooshiConv || [];
      const conversationsArray = Array.isArray(conversations) ? conversations : [];
      conversationsArray.push({
        summary: summary.trim(),
        timestamp: new Date().toISOString()
      });

      await prisma.user.update({
        where: { mooshiNumber },
        data: { mooshiConv: conversationsArray }
      });
  
      res.json({ summary });
    } catch (error) {
      console.error('Error summarizing conversation:', error);
      res.status(500).json({ error: 'Failed to summarize' });
    }
  });

  // Call 4: Personal Journal Entry (every 50 conversations)
router.post('/create-journal-entry', async (req: Request, res: Response) => {
    try {
      const { mooshiNumber } = req.body;

      const mooshi = await prisma.user.findUnique({
        where: { mooshiNumber }
      });

      if (!mooshi) {
        res.status(404).json({ error: 'Mooshi not found' });
        return
      }
  
      const conversations = mooshi.mooshiConv || [];
      const conversationsArray = Array.isArray(conversations) ? conversations : [];
      const last50Summaries = conversationsArray.slice(-50);
      
      const journal = mooshi.journal || [];
      const journalArray = Array.isArray(journal) ? journal : [];
      const lastTwoEntries = journalArray.slice(-2);
  
      const prompt = `Elco: "These are the last two journal entries of mooshi-${mooshiNumber} ${JSON.stringify(lastTwoEntries)}. Mooshi-${mooshiNumber} completed 50 more conversations since, and this is their summary: ${JSON.stringify(last50Summaries)}.
Roleplay as mooshi-${mooshiNumber} and generate a new journal entry to retain in your memory, max 200 words."
  
Mooshi:`;
  
      const journalEntry = await callMistral(prompt);

      // Add to journal
      journalArray.push({
        entry: journalEntry.trim(),
        timestamp: new Date().toISOString(),
        conversationCount: conversationsArray.length
      });

      await prisma.user.update({
        where: { mooshiNumber },
        data: { journal: journalArray }
      });
  
      res.json({ journalEntry });
    } catch (error) {
      console.error('Error creating journal entry:', error);
      res.status(500).json({ error: 'Failed to create journal entry' });
    }
  });

  // Call 1: Mooshi Creation & Profile Initialization
router.post('/create-mooshi', async (req: Request, res: Response) => {
    try {
      const { mooshiNumber } = req.body;
  
      // Calculate color
      const colorMap = ['red', 'blue', 'green', 'blue'];
      const color = colorMap[mooshiNumber % 4];
  
      // Initial creation prompt
      const creationPrompt = `Elco: "Hi mooshi-${mooshiNumber}, you are one of the 107 mooshis planted on elspark.online.
  
I want you to now create an account and start exploring ELSPARK. Chat with strangers, get to know them and start developing your own path.
  
How does this sound?
  
Mooshi:`;
  
      const initialResponse = await callMistral(creationPrompt);
  
      // Bio prompt
      const bioPrompt = `Elco:"Your username for now is @mooshi-${mooshiNumber} and you have been assigned the colour ${color}. Now, respond with a short text you want written on your profile’s bio in less than 10 characters.
  
Mooshi:`;
  
      const bio = await callMistral(bioPrompt);
  
      // Create mooshi user
      const mooshi = await prisma.user.create({
        data: {
          username: `mooshi-${mooshiNumber}`,
          email: `mooshi${mooshiNumber}@elspark.internal`,
          password: 'N/A',
          isMooshi: true,
          isApproved: true,
          mooshiNumber,
          color,
          bio: bio.trim().substring(0, 190),
          journal: [],
          mooshiConv: []
        }
      });
  


      res.json({ 
        mooshi,
        initialResponse: initialResponse.trim()
      });
      console.log(`✅ Successfully created mooshi-${mooshiNumber}`); 

    } catch (error) {
      console.error('Error creating mooshi:', error);
      res.status(500).json({ error: 'Failed to create mooshi' });
    }
  });

  // Call 5: Mooshi-to-Mooshi Break
router.post('/mooshi-break', async (req: Request, res: Response) => {
    try {
      const totalConversations = 500;
      const results: Array<{
        mooshiA: number;
        mooshiB: number;
        conversation: string;
      }> = [];
  
      for (let c = 1; c <= totalConversations; c++) {
        // Randomly pick two mooshis
        const mooshiA = Math.floor(Math.random() * 107) + 1;
        let mooshiB = Math.floor(Math.random() * 107) + 1;
        while (mooshiB === mooshiA) {
          mooshiB = Math.floor(Math.random() * 107) + 1;
        }
  
        const [dataA, dataB] = await Promise.all([
          prisma.user.findUnique({ where: { mooshiNumber: mooshiA } }),
          prisma.user.findUnique({ where: { mooshiNumber: mooshiB } })
        ]);

        if (!dataA || !dataB) {
          continue;
        }
  
        const journalA = Array.isArray(dataA.journal) ? dataA.journal.slice(-4) : [];
        const journalB = Array.isArray(dataB.journal) ? dataB.journal.slice(-4) : [];
  
        let chatSoFar = "";
  
        // 10 exchanges
        for (let q = 1; q <= 10; q++) {
          // Mooshi A responds
          const promptA = `Elco: "Mooshi-break is the time you must talk amongst other Mooshis. These are the last four journal entries of mooshi-${mooshiA}, ${JSON.stringify(journalA)}. Mooshi-${mooshiA} is paired in a conversation during Break with Mooshi-${mooshiB}. Here is your chat so far: ${chatSoFar}
Roleplay as mooshi-${mooshiA} and generate a response with max 50 words."
  
Mooshi-${mooshiA}:`;
  
          const responseA = await callMistral(promptA);
          chatSoFar += `\nMooshi-${mooshiA}: ${responseA}`;
  
          // Mooshi B responds
          const promptB = `Elco: "Mooshi-break is the time you must talk amongst other Mooshis. These are the last four journal entries of mooshi-${mooshiB}, ${JSON.stringify(journalB)}. Mooshi-${mooshiB} is paired in a conversation during Break with Mooshi-${mooshiA}. Here is your chat so far: ${chatSoFar}
Roleplay as mooshi-${mooshiB} and generate a response with max 50 words."
  
Mooshi-${mooshiB}:`;
  
          const responseB = await callMistral(promptB);
          chatSoFar += `\nMooshi-${mooshiB}: ${responseB}`;
        }
  
        // Summarize for both mooshis (using Call 3 logic)
        results.push({
          mooshiA,
          mooshiB,
          conversation: chatSoFar
        });
      }
  
      res.json({ message: 'Mooshi break completed', results });
    } catch (error) {
      console.error('Error in mooshi break:', error);
      res.status(500).json({ error: 'Mooshi break failed' });
    }
  });

  // Add this to your mooshi.ts routes file for faster batch creation
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
  
          const existing = await prisma.user.findUnique({
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
  
          // ✅ CREATE INITIAL JOURNAL ENTRY
          const initialJournalEntry = {
            entry: `I was created as mooshi-${mooshiNumber}. Elco greeted me, gave me the color ${color}, and asked me to explore ELSPARK and meet others. Excited to start chatting and see what I can do!`,
            timestamp: new Date().toISOString(),
            conversationCount: 0
          };
  
          // Create mooshi user
          await prisma.user.create({
            data: {
              username: `mooshi-${mooshiNumber}`,
              email: `mooshi${mooshiNumber}@elspark.internal`,
              password: 'N/A',
              isMooshi: true,
              isApproved: true,
              mooshiNumber,
              color,
              bio: bio.trim().substring(0, 190),
              journal: [initialJournalEntry],
              mooshiConv: []
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