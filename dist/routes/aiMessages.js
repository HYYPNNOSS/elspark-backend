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
// GET /api/ai-messages/:sessionId - Get messages for a session
router.get('/:sessionId', aiMiddleware_1.aiMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.userId;
        // Verify session belongs to user
        const session = await prisma.aISession.findFirst({
            where: {
                id: sessionId,
                userId
            }
        });
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        // Get messages for this session
        const messages = await prisma.aIMsg.findMany({
            where: {
                userId,
                sessionId
            },
            orderBy: { createdAt: 'asc' }
        });
        // Format messages for chat interface
        const formattedMessages = messages.map(msg => ({
            id: msg.id,
            content: msg.message,
            senderId: msg.sender === 'user' ? userId : session.botId,
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
