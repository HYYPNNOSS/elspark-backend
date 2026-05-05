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
router.get('/:sessionId', authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user?.profileId || req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
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
                profileId: userId,
                sessionId
            },
            orderBy: { createdAt: 'asc' }
        });
        const formattedMessages = messages.map(msg => ({
            id: msg.id,
            content: msg.message,
            senderId: msg.sender === 'user' ? userId : `bot-${session.botId}`,
            receiverId: msg.sender === 'user' ? session.botId : userId,
            createdAt: msg.createdAt.toISOString()
        }));
        res.json(formattedMessages);
    }
    catch (error) {
        console.error('Error fetching AI messages:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
