"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.post('/', authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const { botId, duration, cost } = req.body;
        const profileId = req.user?.profileId || req.user?.userId;
        const accountId = req.user?.accountId;
        console.log("profileId:", profileId);
        console.log("accountId:", accountId);
        if (!req.user || !profileId) {
            console.log("Unauthorized: no user in request");
            res.status(401).json({ error: 'Unauthorized: no user in request' });
            return;
        }
        const profile = await prisma.profile.findUnique({
            where: { id: profileId },
            include: { account: true }
        });
        if (!profile) {
            res.status(404).json({ error: 'Profile not found' });
            return;
        }
        const userCoins = profile.account.cyberCoins ? Number(profile.account.cyberCoins) : 0;
        if (userCoins < cost) {
            res.status(400).json({ error: 'Insufficient coins' });
            return;
        }
        const endTime = new Date(Date.now() + duration * 60 * 1000);
        const session = await prisma.aISession.create({
            data: {
                profileId: profileId,
                botId,
                duration,
                endTime,
                isActive: true
            }
        });
        await prisma.account.update({
            where: { id: profile.accountId },
            data: { cyberCoins: { decrement: cost } }
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
router.get('/active', authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const profileId = req.user?.profileId || req.user?.userId;
        if (!profileId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const now = new Date();
        const BOT_CONFIG = {
            1: { name: "Aero", emoji: "🧠" },
            2: { name: "Zayd", emoji: "👨‍🍳" },
            3: { name: "OneRoid", emoji: "🌙" },
            4: { name: "Zainab", emoji: "🏊‍♀️" }
        };
        const sessions = await prisma.aISession.findMany({
            where: {
                profileId: profileId,
                isActive: true,
                endTime: { gt: now }
            }
        });
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
router.get('/history/:botId', authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const { botId } = req.params;
        const profileId = req.user?.profileId || req.user?.userId;
        if (!profileId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const sessions = await prisma.aISession.findMany({
            where: {
                profileId: profileId,
                botId: parseInt(botId)
            },
            orderBy: { startTime: 'desc' }
        });
        res.json({
            hasHistory: sessions.length > 0,
            sessions: sessions.map(s => ({
                id: s.id,
                startTime: s.startTime,
                endTime: s.endTime,
                isActive: s.isActive,
                duration: s.duration
            }))
        });
    }
    catch (error) {
        console.error('Error fetching session history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.post('/extend', authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const { sessionId } = req.body;
        const profileId = req.user?.profileId || req.user?.userId;
        const extensionMinutes = 5;
        const extensionCost = 1;
        if (!profileId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const session = await prisma.aISession.findUnique({
            where: { id: sessionId },
            include: { profile: { include: { account: true } } }
        });
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        if (session.profileId !== profileId) {
            res.status(403).json({ error: 'Unauthorized to extend this session' });
            return;
        }
        const userCoins = session.profile.account.cyberCoins ? Number(session.profile.account.cyberCoins) : 0;
        if (userCoins < extensionCost) {
            res.status(400).json({ error: 'Insufficient coins' });
            return;
        }
        const newEndTime = new Date(session.endTime.getTime() + extensionMinutes * 60 * 1000);
        const updatedSession = await prisma.aISession.update({
            where: { id: sessionId },
            data: {
                endTime: newEndTime,
                duration: session.duration + extensionMinutes,
                isActive: true
            }
        });
        await prisma.account.update({
            where: { id: session.profile.accountId },
            data: { cyberCoins: { decrement: extensionCost } }
        });
        res.json({
            message: 'Session extended successfully',
            session: updatedSession
        });
    }
    catch (error) {
        console.error('Error extending session:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
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
