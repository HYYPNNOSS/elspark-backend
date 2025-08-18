"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const aiMiddleware_1 = require("../middlewares/aiMiddleware");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// POST /api/ai-sessions - Create new AI session
router.post('/', aiMiddleware_1.aiMiddleware, async (req, res) => {
    try {
        const { botId, duration, cost } = req.body;
        const userId = req.user.userId;
        console.log("userId");
        console.log(userId);
        console.log("userId");
        if (!req.user) {
            console.log("Unauthorized: no user in request");
            res.status(401).json({ error: 'Unauthorized: no user in request' });
            return;
        }
        // Check user has enough coins
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user || user.cyberCoins < cost) {
            res.status(400).json({ error: 'Insufficient coins' });
            return;
        }
        // Create AI session
        const endTime = new Date(Date.now() + duration * 60 * 1000);
        const session = await prisma.aISession.create({
            data: {
                userId,
                botId,
                duration,
                endTime,
                isActive: true
            }
        });
        // Deduct coins
        await prisma.user.update({
            where: { id: userId },
            data: { cyberCoins: user.cyberCoins - cost }
        });
        res.json({
            sessionId: session.id,
            endTime: session.endTime
        });
    }
    catch (error) {
        console.error('Error creating AI session:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/ai-sessions/active - Get user's active sessions
router.get('/active', aiMiddleware_1.aiMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const now = new Date();
        const BOT_CONFIG = {
            1: { name: "Aero", emoji: "🧠" },
            2: { name: "Zayd", emoji: "👨‍🍳" },
            3: { name: "OneRoid", emoji: "🌙" },
            4: { name: "Zainab", emoji: "🏊‍♀️" }
        };
        // Get active sessions
        const sessions = await prisma.aISession.findMany({
            where: {
                userId,
                isActive: true,
                endTime: { gt: now }
            }
        });
        // Format for frontend
        const aiBots = sessions.map((session) => ({
            id: session.botId,
            name: BOT_CONFIG[session.botId]?.name || 'Unknown',
            emoji: BOT_CONFIG[session.botId]?.emoji || '🤖',
            sessionId: session.id,
            endTime: session.endTime.toISOString()
        }));
        res.json(aiBots);
    }
    catch (error) {
        console.error('Error fetching active sessions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/ai-sessions/cleanup - Cleanup expired sessions
router.post('/cleanup', async (req, res) => {
    try {
        const now = new Date();
        await prisma.aISession.updateMany({
            where: {
                endTime: { lt: now },
                isActive: true
            },
            data: {
                isActive: false
            }
        });
        res.json({ message: 'Sessions cleaned up' });
    }
    catch (error) {
        console.error('Error cleaning up sessions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
