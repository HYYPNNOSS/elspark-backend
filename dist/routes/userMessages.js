"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.get('/', async (req, res) => {
    try {
        const { userId, otherUserId } = req.query;
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    {
                        AND: [
                            { senderId: parseInt(userId) },
                            { receiverId: parseInt(otherUserId) }
                        ]
                    },
                    {
                        AND: [
                            { senderId: parseInt(otherUserId) },
                            { receiverId: parseInt(userId) }
                        ]
                    }
                ]
            },
            orderBy: {
                createdAt: 'asc'
            },
            include: {
                sender: {
                    select: {
                        id: true,
                        username: true,
                        // email: true
                    }
                },
                receiver: {
                    select: {
                        id: true,
                        username: true,
                        // email: true
                    }
                }
            }
        });
        res.json(messages);
    }
    catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
