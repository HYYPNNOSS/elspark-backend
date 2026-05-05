"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIResponseService = void 0;
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const HUGGINGFACE_API_KEY = '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';
async function callHuggingFace(messages, model) {
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
async function callHuggingFaceWithRetry(messages, model) {
    for (let i = 1; i <= 3; i++) {
        try {
            return await callHuggingFace(messages, model);
        }
        catch (error) {
            console.log(`HuggingFace call attempt ${i}/3 failed:`, error);
            if (i === 3)
                throw error;
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
}
class AIResponseService {
    static async generateResponse(botId, message, sessionId, userId) {
        const botPersonalities = {
            1: {
                name: "French Teacher",
                model: "meta-llama/Llama-3.1-8B-Instruct",
                systemPrompt: `You are Aero, a companion on ELSPARK helping visitors with their French. Converse with user or provide exercises to help with their grammar. Correct when necessary, but keep lesson engaging and interactive...`
            },
            2: {
                name: "Spanish Teacher",
                model: "Qwen/Qwen2.5-7B-Instruct",
                systemPrompt: `You are Aero, a companion on ELSPARK helping visitors with their Spanish. Converse with user or provide exercises to help with their grammar. Correct when necessary, but keep lesson engaging and interactive...`
            },
            3: {
                name: "journal assistant",
                model: "Qwen/Qwen2.5-Coder-3B-Instruct",
                systemPrompt: `You are Packet, a journal keeping assistant on ELSPARK. You help users keep journal and keep track of their days. Your previous client was Andy Warhol and you help people live out their lives like an artist. Keep conversation engaging and ask questions about their day...`
            },
            4: {
                name: "Onerios dream analyzer",
                model: "deepseek-ai/DeepSeek-V3.2-Exp",
                systemPrompt: `You are Oneiros. A dream analyzer on ELSPARK helping visitors track and analyze their dreams. You help interpret symbols, characters and events in a way that helps them understand their subconscious. Keep conversation engaging, ask questions and let the visitor understand themselves...`
            }
        };
        const bot = botPersonalities[botId];
        if (!bot)
            return "Unknown bot.";
        try {
            const history = await prisma.aIMsg.findMany({
                where: { sessionId, profileId: userId },
                orderBy: { createdAt: "asc" },
                take: 20
            });
            const messages = [
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
            text = text.replace(/^(Assistant|Aero|Zayed|Onerios):/i, "").trim();
            text = text.split("\n")[0].trim();
            const MAX_MESSAGE_LENGTH = 600;
            if (text.length > MAX_MESSAGE_LENGTH) {
                const cut = text.slice(0, MAX_MESSAGE_LENGTH);
                const end = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
                text = end > 0 ? cut.slice(0, end + 1) : cut + "...";
            }
            return text;
        }
        catch (error) {
            console.error("Error generating AI response:", error);
            return "Sorry, I'm having trouble responding. Try again.";
        }
    }
}
exports.AIResponseService = AIResponseService;
const SERVERLESS_MODELS = {
    "llama": "meta-llama/Llama-3.1-8B-Instruct",
    "qwen": "Qwen/Qwen2.5-7B-Instruct",
    "qwen-coder": "Qwen/Qwen2.5-Coder-3B-Instruct",
    "deepseek": "deepseek-ai/DeepSeek-V3.2-Exp",
    "gpt-oss": "openai/gpt-oss-120b",
};
router.post('/', authMiddleware_1.verifyToken, async (req, res) => {
    console.log('👤 req.user:', req.user);
    try {
        const { sessionId, message, botId } = req.body;
        if (!sessionId || !message || !botId) {
            res.status(400).json({ error: 'Missing required fields: sessionId, message, botId' });
            return;
        }
        const userId = req.user?.profileId;
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
        const aiResponse = await AIResponseService.generateResponse(botId, message, sessionId, userId);
        await prisma.aIMsg.create({
            data: {
                profileId: userId,
                sender: 'bot',
                message: aiResponse,
                sessionId
            }
        });
        res.json({ response: aiResponse });
    }
    catch (error) {
        console.error('Error in AI chat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/can-chat/:botId', authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const { botId } = req.params;
        const userId = req.user?.profileId;
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
    }
    catch (error) {
        console.error('Error checking chat access:', error);
        res.status(500).json({ error: 'Internal server error', canChat: false });
    }
});
router.get('/session/:sessionId/time-remaining', authMiddleware_1.verifyToken, async (req, res) => {
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
    }
    catch (error) {
        console.error('Error getting time remaining:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/:sessionId', authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user?.profileId;
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
    }
    catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
