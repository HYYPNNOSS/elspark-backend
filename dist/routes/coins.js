"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// Mock middleware to simulate auth
const mockAuth = (req, res, next) => {
    const userId = parseInt(req.headers['user-id']);
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    req.userId = userId;
    next();
};
router.post('/buy', mockAuth, async (req, res) => {
    const { amount } = req.body;
    const validAmounts = [10, 20, 30, 40];
    if (!validAmounts.includes(amount)) {
        res.status(400).json({ message: 'Invalid amount' });
        return;
    }
    try {
        const updatedUser = await prisma.user.update({
            where: { id: req.userId },
            data: { cyberCoins: { increment: amount } },
            select: {
                id: true,
                username: true,
                cyberCoins: true
            }
        });
        res.json({
            message: `Added ${amount} coins`,
            cyberCoins: updatedUser.cyberCoins
        });
    }
    catch (error) {
        console.error('Error adding coins:', error);
        res.status(500).json({ error: 'Failed to add coins' });
    }
});
exports.default = router;
