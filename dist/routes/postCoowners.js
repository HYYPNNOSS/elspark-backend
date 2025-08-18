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
// Add coowner to a post (requires 1 cyber coin payment to post owner)
router.post("/coown/:postId", authMiddleware_1.verifyToken, async (req, res) => {
    const userId = req.user.id;
    const postId = Number(req.params.postId);
    const coinAmount = 1; // Fixed amount for co-owning
    try {
        // Get the post with author information
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: { author: true },
        });
        if (!post) {
            res.status(404).json({ error: "Post not found" });
            return;
        }
        // Check if user is trying to co-own their own post
        if (post.authorId === userId) {
            res.status(400).json({ error: "Cannot co-own your own post" });
            return;
        }
        // Check if user already co-owns this post
        const existingCoowner = await prisma.postCoowner.findUnique({
            where: {
                postId_userId: {
                    postId: postId,
                    userId: userId,
                },
            },
        });
        if (existingCoowner) {
            res.status(400).json({ error: "Already a co-owner of this post" });
            return;
        }
        // Get current user's balance
        const currentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true, cyberCoins: true },
        });
        if (!currentUser) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        // Check if user has enough cyber coins
        if (currentUser.cyberCoins < coinAmount) {
            res
                .status(400)
                .json({
                error: "Insufficient cyber coins. You need 1 cyber coin to co-own this post.",
            });
            return;
        }
        // Perform the transaction: transfer coin and create co-ownership
        await prisma.$transaction([
            // Deduct coin from current user
            prisma.user.update({
                where: { id: userId },
                data: { cyberCoins: { decrement: coinAmount } },
            }),
            // Add coin to post owner
            prisma.user.update({
                where: { id: post.authorId },
                data: { cyberCoins: { increment: coinAmount } },
            }),
            // Create co-ownership record
            prisma.postCoowner.create({
                data: { postId, userId },
            }),
        ]);
        // Get updated balance for response
        const updatedUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { cyberCoins: true },
        });
        res.json({
            message: `You now co-own this post! 1 cyber coin sent to ${post.author.username}`,
            yourBalance: updatedUser?.cyberCoins,
            coinsSent: coinAmount,
            postOwner: post.author.username,
        });
    }
    catch (error) {
        console.error("Failed to co-own post:", error);
        res.status(500).json({ error: "Server error" });
    }
});
router.get("/coowned/:targetId", authMiddleware_1.verifyToken, async (req, res) => {
    const targetId = Number(req.params.targetId);
    try {
        const coowned = await prisma.postCoowner.findMany({
            where: { userId: targetId },
            include: {
                post: {
                    select: {
                        id: true,
                        text: true,
                        imageUrl: true,
                        videoUrl: true,
                        isPrivate: true,
                        createdAt: true,
                        updatedAt: true,
                        author: {
                            select: {
                                id: true,
                                username: true,
                                profilePicture: true,
                            },
                        },
                    },
                },
            },
        });
        res.json(coowned.map((item) => item.post));
    }
    catch (error) {
        res.status(500).json({ error: "Server error" });
    }
});
exports.default = router;
