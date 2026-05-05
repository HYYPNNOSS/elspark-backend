"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const wasabi_config_1 = require("../config/wasabi-config");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.get("/", async (req, res) => {
    try {
        const profiles = await prisma.profile.findMany({
            select: {
                id: true,
                username: true,
                bio: true,
                profilePicture: true,
                accountId: true,
                account: {
                    select: {
                        email: true,
                        cyberCoins: true,
                    },
                },
            },
        });
        res.json(profiles);
    }
    catch (error) {
        console.error("Error fetching profiles:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/me", authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const profileId = req.user.profileId || req.user.id;
        const profile = await prisma.profile.findUnique({
            where: { id: profileId },
            include: {
                account: {
                    select: {
                        id: true,
                        email: true,
                        cyberCoins: true,
                    },
                },
            },
        });
        if (!profile) {
            res.status(404).json({ error: "Profile not found" });
            return;
        }
        res.status(200).json({
            user: {
                id: profile.id,
                accountId: profile.accountId,
                username: profile.username,
                email: profile.account.email,
                profilePicture: profile.profilePicture,
                bio: profile.bio,
                cyberCoins: Number(profile.account.cyberCoins),
                online: profile.online,
                isApproved: profile.isApproved,
            },
        });
    }
    catch (error) {
        console.error("Error fetching current user:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/notifications", authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const profileId = req.user.profileId || req.user.id;
        const notifications = await prisma.notification.findMany({
            where: { profileId: profileId },
            orderBy: { createdAt: "desc" },
        });
        res.status(200).json(notifications);
    }
    catch (error) {
        console.error("Error fetching notifications:", error);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
});
router.get("/public_post", async (req, res) => {
    try {
        const publicPosts = await prisma.post.findMany({
            where: { isPrivate: false },
            select: {
                id: true,
                text: true,
                imageUrl: true,
                videoUrl: true,
                isAnonymous: true,
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
            orderBy: { createdAt: "desc" },
        });
        res.json(publicPosts);
    }
    catch (err) {
        console.error("Error fetching public posts", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/id/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const profile = await prisma.profile.findUnique({
            where: { id: Number(id) },
            select: {
                id: true,
                username: true,
                profilePicture: true,
                bio: true,
                createdAt: true,
                updatedAt: true,
                online: true,
                isonrand: true,
                looking: true,
                accountId: true,
                account: {
                    select: {
                        email: true,
                        cyberCoins: true,
                    },
                },
                posts: {
                    select: {
                        id: true,
                        title: true,
                        text: true,
                        imageUrl: true,
                        videoUrl: true,
                        isAnonymous: true,
                        isPrivate: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!profile) {
            res.status(404).json({ error: "Profile not found" });
            return;
        }
        res.json({
            user: {
                id: profile.id,
                accountId: profile.accountId,
                username: profile.username,
                email: profile.account.email,
                profilePicture: profile.profilePicture,
                bio: profile.bio,
                cyberCoins: Number(profile.account.cyberCoins),
                createdAt: profile.createdAt,
                updatedAt: profile.updatedAt,
                online: profile.online,
                isonrand: profile.isonrand,
                looking: profile.looking,
                posts: profile.posts,
            },
        });
    }
    catch (err) {
        console.error("Error fetching profile by ID:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/:username", async (req, res) => {
    const { username } = req.params;
    try {
        const profile = await prisma.profile.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
                profilePicture: true,
                bio: true,
                createdAt: true,
                updatedAt: true,
                online: true,
                isonrand: true,
                looking: true,
                isApproved: true,
                accountId: true,
                account: {
                    select: {
                        email: true,
                        cyberCoins: true,
                    },
                },
                posts: {
                    select: {
                        id: true,
                        text: true,
                        imageUrl: true,
                        videoUrl: true,
                        isAnonymous: true,
                        isPrivate: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!profile) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        res.status(200).json({
            user: {
                id: profile.id,
                accountId: profile.accountId,
                username: profile.username,
                email: profile.account.email,
                profilePicture: profile.profilePicture,
                bio: profile.bio,
                cyberCoins: Number(profile.account.cyberCoins),
                createdAt: profile.createdAt,
                updatedAt: profile.updatedAt,
                online: profile.online,
                isonrand: profile.isonrand,
                looking: profile.looking,
                isApproved: profile.isApproved,
                posts: profile.posts,
            },
        });
    }
    catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/send-coins", authMiddleware_1.verifyToken, async (req, res) => {
    const { recipientId, amount } = req.body;
    const senderProfileId = req.user.profileId || req.user.id;
    if (!recipientId || !amount) {
        res.status(400).json({ error: "Recipient ID and amount are required" });
        return;
    }
    if (typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "Amount must be a positive number" });
        return;
    }
    if (senderProfileId === recipientId) {
        res.status(400).json({ error: "Cannot send coins to yourself" });
        return;
    }
    const roundedAmount = Math.round(amount * 100) / 100;
    try {
        const senderProfile = await prisma.profile.findUnique({
            where: { id: senderProfileId },
            include: { account: true },
        });
        if (!senderProfile) {
            res.status(404).json({ error: "Sender profile not found" });
            return;
        }
        const recipientProfile = await prisma.profile.findUnique({
            where: { id: recipientId },
            include: { account: true },
        });
        if (!recipientProfile) {
            res.status(404).json({ error: "Recipient not found" });
            return;
        }
        if (senderProfile.accountId === recipientProfile.accountId) {
            res
                .status(400)
                .json({ error: "Cannot transfer coins between your own profiles" });
            return;
        }
        const senderCoins = Number(senderProfile.account.cyberCoins);
        if (senderCoins < roundedAmount) {
            res.status(400).json({ error: "Insufficient cyber coins" });
            return;
        }
        await prisma.$transaction([
            prisma.account.update({
                where: { id: senderProfile.accountId },
                data: { cyberCoins: { decrement: roundedAmount } },
            }),
            prisma.account.update({
                where: { id: recipientProfile.accountId },
                data: { cyberCoins: { increment: roundedAmount } },
            }),
        ]);
        const updatedSenderAccount = await prisma.account.findUnique({
            where: { id: senderProfile.accountId },
            select: { cyberCoins: true },
        });
        res.status(200).json({
            message: `Successfully sent ${roundedAmount} cyber coins to ${recipientProfile.username}`,
            senderBalance: updatedSenderAccount?.cyberCoins,
            amountSent: roundedAmount,
            recipient: recipientProfile.username,
        });
    }
    catch (error) {
        console.error("Failed to send cyber coins:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
router.put("/:id/bio", authMiddleware_1.verifyToken, async (req, res) => {
    const { id } = req.params;
    const { bio } = req.body;
    const profileId = req.user.profileId || req.user.id;
    if (parseInt(id) !== profileId) {
        res.status(403).json({ error: "You can only update your own bio" });
        return;
    }
    try {
        const updatedProfile = await prisma.profile.update({
            where: { id: parseInt(id) },
            data: { bio },
            include: {
                account: {
                    select: {
                        email: true,
                        cyberCoins: true,
                    },
                },
            },
        });
        res.status(200).json({
            message: "Bio updated successfully",
            user: {
                id: updatedProfile.id,
                accountId: updatedProfile.accountId,
                username: updatedProfile.username,
                email: updatedProfile.account.email,
                bio: updatedProfile.bio,
                profilePicture: updatedProfile.profilePicture,
                cyberCoins: Number(updatedProfile.account.cyberCoins),
            },
        });
    }
    catch (error) {
        console.error("Error updating bio:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put("/:id/profile-picture", authMiddleware_1.verifyToken, wasabi_config_1.profilePictureUpload.single("profilePicture"), async (req, res) => {
    const { id } = req.params;
    const profileId = req.user.profileId || req.user.id;
    if (parseInt(id) !== profileId) {
        res
            .status(403)
            .json({ error: "You can only update your own profile picture" });
        return;
    }
    if (!req.file) {
        res.status(400).json({ error: "No image file provided" });
        return;
    }
    try {
        const profilePicturePath = req.file.location;
        const prefix = "https://elspark.s3.eu-west-1.wasabisys.com";
        let path = profilePicturePath;
        if (path.startsWith(prefix)) {
            path = path.substring(prefix.length);
        }
        console.log(path);
        const updatedProfile = await prisma.profile.update({
            where: { id: parseInt(id) },
            data: { profilePicture: path },
            include: {
                account: {
                    select: {
                        email: true,
                        cyberCoins: true,
                    },
                },
            },
        });
        res.status(200).json({
            message: "Profile picture updated successfully",
            user: {
                id: updatedProfile.id,
                accountId: updatedProfile.accountId,
                username: updatedProfile.username,
                email: updatedProfile.account.email,
                bio: updatedProfile.bio,
                profilePicture: updatedProfile.profilePicture,
                cyberCoins: Number(updatedProfile.account.cyberCoins),
            },
            profilePictureUrl: profilePicturePath,
        });
    }
    catch (error) {
        console.error("Error updating profile picture:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/:username/posts", async (req, res) => {
    const { username } = req.params;
    try {
        const profile = await prisma.profile.findUnique({
            where: { username },
            select: {
                posts: {
                    select: {
                        id: true,
                        title: true,
                        text: true,
                        imageUrl: true,
                        videoUrl: true,
                        isPrivate: true,
                        isAnonymous: true,
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
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!profile) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        res.status(200).json(profile.posts);
    }
    catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/profile-picture/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const profile = await prisma.profile.findUnique({
            where: { id: Number(id) },
            select: {
                id: true,
                profilePicture: true,
            },
        });
        if (!profile) {
            res.status(404).json({ error: "Profile not found" });
            return;
        }
        res.status(200).json({
            id: profile.id,
            profilePicture: profile.profilePicture,
        });
    }
    catch (err) {
        console.error("Error fetching profile picture:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put("/:id", authMiddleware_1.verifyToken, wasabi_config_1.profilePictureUpload.single("profilePicture"), async (req, res) => {
    const { id } = req.params;
    const profileId = req.user.profileId || req.user.id;
    const bio = req.body.bio;
    const profilePictureFile = req.file;
    if (parseInt(id) !== profileId) {
        res.status(403).json({ error: "You can only update your own profile" });
        return;
    }
    const updateData = {};
    if (bio !== undefined)
        updateData.bio = bio;
    if (profilePictureFile) {
        updateData.profilePicture = profilePictureFile.location;
    }
    try {
        const updatedProfile = await prisma.profile.update({
            where: { id: parseInt(id) },
            data: updateData,
            include: {
                account: {
                    select: {
                        email: true,
                        cyberCoins: true,
                    },
                },
            },
        });
        res.status(200).json({
            message: "Profile updated successfully",
            user: {
                id: updatedProfile.id,
                accountId: updatedProfile.accountId,
                username: updatedProfile.username,
                email: updatedProfile.account.email,
                bio: updatedProfile.bio,
                profilePicture: updatedProfile.profilePicture,
                cyberCoins: Number(updatedProfile.account.cyberCoins),
            },
        });
    }
    catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
