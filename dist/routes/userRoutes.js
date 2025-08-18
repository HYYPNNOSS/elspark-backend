"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ./routes/userRoutes.ts
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
// Configure multer for profile picture uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/profiles"); // Make sure this directory exists
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "profile-" + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        }
        else {
            cb(new Error("Only image files are allowed"));
        }
    },
});
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.get("/", async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                username: true,
                email: true,
                bio: true,
                profilePicture: true,
            },
        });
        // console.log(users);
        res.json(users);
    }
    catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/notifications", authMiddleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user.id; // now safe because verifyToken runs first
        const notifications = await prisma.notification.findMany({
            where: { userId },
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
        const user = await prisma.user.findUnique({
            where: { id: Number(id) },
            select: {
                id: true,
                username: true,
                email: true,
                profilePicture: true,
                createdAt: true,
                updatedAt: true,
                online: true,
                isonrand: true,
                looking: true,
                posts: {
                    select: {
                        id: true,
                        text: true,
                        imageUrl: true,
                        isPrivate: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        res.json({ user });
    }
    catch (err) {
        console.error("Error fetching user by ID:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get("/:username", async (req, res) => {
    const { username } = req.params;
    try {
        const user = await prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
                email: true,
                profilePicture: true,
                bio: true,
                createdAt: true,
                updatedAt: true,
                online: true,
                isonrand: true,
                cyberCoins: true,
                looking: true,
                posts: {
                    select: {
                        id: true,
                        text: true,
                        imageUrl: true,
                        isPrivate: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        res.status(200).json({ user });
    }
    catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/send-coins", authMiddleware_1.verifyToken, async (req, res) => {
    const { recipientId, amount } = req.body;
    const senderId = req.user.id;
    // Validation
    if (!recipientId || !amount) {
        res.status(400).json({ error: "Recipient ID and amount are required" });
        return;
    }
    if (typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "Amount must be a positive number" });
        return;
    }
    if (senderId === recipientId) {
        res.status(400).json({ error: "Cannot send coins to yourself" });
        return;
    }
    // Round to 2 decimal places to handle floating point precision
    const roundedAmount = Math.round(amount * 100) / 100;
    try {
        // Check if recipient exists
        const recipient = await prisma.user.findUnique({
            where: { id: recipientId },
            select: { id: true, username: true, cyberCoins: true },
        });
        if (!recipient) {
            res.status(404).json({ error: "Recipient not found" });
            return;
        }
        // Check sender's balance
        const sender = await prisma.user.findUnique({
            where: { id: senderId },
            select: { id: true, username: true, cyberCoins: true },
        });
        if (!sender) {
            res.status(404).json({ error: "Sender not found" });
            return;
        }
        if (sender.cyberCoins < roundedAmount) {
            res.status(400).json({ error: "Insufficient cyber coins" });
            return;
        }
        // Perform the transaction
        await prisma.$transaction([
            // Deduct from sender
            prisma.user.update({
                where: { id: senderId },
                data: { cyberCoins: { decrement: roundedAmount } },
            }),
            // Add to recipient
            prisma.user.update({
                where: { id: recipientId },
                data: { cyberCoins: { increment: roundedAmount } },
            }),
        ]);
        // Get updated balances
        const updatedSender = await prisma.user.findUnique({
            where: { id: senderId },
            select: { cyberCoins: true },
        });
        res.status(200).json({
            message: `Successfully sent ${roundedAmount} cyber coins to ${recipient.username}`,
            senderBalance: updatedSender?.cyberCoins,
            amountSent: roundedAmount,
            recipient: recipient.username,
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
    const userId = req.user.id;
    // Check if user is updating their own bio
    if (parseInt(id) !== userId) {
        res.status(403).json({ error: "You can only update your own bio" });
        return;
    }
    try {
        const updatedUser = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { bio },
            select: {
                id: true,
                username: true,
                email: true,
                bio: true,
                profilePicture: true,
                cyberCoins: true,
            },
        });
        res.status(200).json({
            message: "Bio updated successfully",
            user: updatedUser,
        });
    }
    catch (error) {
        console.error("Error updating bio:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put("/:id/profile-picture", authMiddleware_1.verifyToken, upload.single("profilePicture"), async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    // Check if user is updating their own profile picture
    if (parseInt(id) !== userId) {
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
        const profilePicturePath = `/uploads/profiles/${req.file.filename}`;
        const updatedUser = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { profilePicture: profilePicturePath },
            select: {
                id: true,
                username: true,
                email: true,
                bio: true,
                profilePicture: true,
                cyberCoins: true,
            },
        });
        res.status(200).json({
            message: "Profile picture updated successfully",
            user: updatedUser,
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
        const user = await prisma.user.findUnique({
            where: { username },
            select: {
                posts: {
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
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        res.status(200).json(user.posts);
    }
    catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.put("/:id", authMiddleware_1.verifyToken, upload.single("profilePicture"), async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const bio = req.body.bio;
    const profilePictureFile = req.file;
    if (parseInt(id) !== userId) {
        res.status(403).json({ error: "You can only update your own profile" });
        return;
    }
    const updateData = {};
    if (bio !== undefined)
        updateData.bio = bio;
    if (profilePictureFile) {
        updateData.profilePicture = `/uploads/profiles/${profilePictureFile.filename}`;
    }
    try {
        const updatedUser = await prisma.user.update({
            where: { id: parseInt(id) },
            data: updateData,
            select: {
                id: true,
                username: true,
                email: true,
                bio: true,
                profilePicture: true,
                cyberCoins: true,
            },
        });
        res.status(200).json({
            message: "Profile updated successfully",
            user: updatedUser,
        });
    }
    catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
