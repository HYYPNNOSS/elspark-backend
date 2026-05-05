"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
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
    console.log("amount");
    const { amount } = req.body;
    const validAmounts = [5, 10, 15, 20];
    console.log(amount);
    if (!validAmounts.includes(amount)) {
        res.status(400).json({ message: 'Invalid amount' });
        console.log("amount");
        return;
    }
    try {
        const updatedUser = await prisma.account.update({
            where: { id: req.userId },
            data: { cyberCoins: { increment: amount } },
            select: {
                id: true,
                // username: true,
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
