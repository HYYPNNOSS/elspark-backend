"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const notificationsRoutes_1 = require("./notificationsRoutes");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.post("/coown/:postId", authMiddleware_1.verifyToken, async (req, res) => {
    const profileId = req.user.profileId || req.user.id;
    const postId = Number(req.params.postId);
    const coinAmount = 1;
    try {
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: {
                author: {
                    include: {
                        account: true
                    }
                }
            },
        });
        if (!post) {
            res.status(404).json({ error: "Post not found" });
            return;
        }
        if (post.authorId === profileId) {
            res.status(400).json({ error: "Cannot co-own your own post" });
            return;
        }
        const existingCoowner = await prisma.postCoowner.findUnique({
            where: {
                postId_userId: {
                    postId: postId,
                    userId: profileId,
                },
            },
        });
        if (existingCoowner) {
            res.status(400).json({ error: "Already a co-owner of this post" });
            return;
        }
        const currentProfile = await prisma.profile.findUnique({
            where: { id: profileId },
            include: { account: true },
        });
        if (!currentProfile) {
            res.status(404).json({ error: "Profile not found" });
            return;
        }
        const currentUserCoins = Number(currentProfile.account.cyberCoins);
        if (currentUserCoins < coinAmount) {
            res.status(400).json({
                error: "Insufficient cyber coins. You need 1 cyber coin to co-own this post.",
            });
            return;
        }
        if (currentProfile.accountId === post.author.accountId) {
            res.status(400).json({
                error: "Cannot co-own posts from your other profiles"
            });
            return;
        }
        await prisma.$transaction([
            prisma.account.update({
                where: { id: currentProfile.accountId },
                data: { cyberCoins: { decrement: coinAmount } },
            }),
            prisma.account.update({
                where: { id: post.author.accountId },
                data: { cyberCoins: { increment: coinAmount } },
            }),
            prisma.postCoowner.create({
                data: { postId, userId: profileId },
            }),
        ]);
        const updatedAccount = await prisma.account.findUnique({
            where: { id: currentProfile.accountId },
            select: { cyberCoins: true },
        });
        await (0, notificationsRoutes_1.createNotification)('coowner', `${currentProfile.username} purchased a copy of your digi-post`, post.authorId, undefined, undefined, `/profile/${currentProfile.username}`);
        res.json({
            message: `You now co-own this post! 1 cyber coin sent to ${post.author.username}`,
            yourBalance: updatedAccount?.cyberCoins,
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
                        title: true,
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
