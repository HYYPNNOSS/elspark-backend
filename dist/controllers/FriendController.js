"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFriends = exports.getPendingRequests = exports.declineRequest = exports.acceptRequest = exports.getRequestStatus = exports.sendRequest = void 0;
const client_1 = require("@prisma/client");
const notificationsRoutes_1 = require("../routes/notificationsRoutes");
const prisma = new client_1.PrismaClient();
const sendRequest = async (req, res) => {
    const { friendId } = req.body;
    const userId = req.user?.id;
    if (!userId || userId === friendId) {
        res.status(400).json({ error: "Invalid request" });
        return;
    }
    try {
        const existing = await prisma.friendRequest.findFirst({
            where: {
                OR: [
                    { senderId: userId, receiverId: friendId },
                    { senderId: friendId, receiverId: userId },
                ],
            },
        });
        if (existing) {
            res.status(400).json({ error: "Request already exists" });
            return;
        }
        await (0, notificationsRoutes_1.createNotification)('friend_request', `${req.user?.username} sent you a friend request`, friendId, undefined, undefined, '/personal');
        const request = await prisma.friendRequest.create({
            data: {
                senderId: userId,
                receiverId: friendId,
                status: "pending",
            },
        });
        res.status(201).json(request);
    }
    catch (err) {
        res.status(500).json({ error: "Internal error" });
    }
};
exports.sendRequest = sendRequest;
const getRequestStatus = async (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.user?.id;
    if (!currentUserId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    try {
        const friendId = parseInt(userId);
        if (currentUserId === friendId) {
            res.status(400).json({ error: "Cannot check status with yourself" });
            return;
        }
        const existingFriendship = await prisma.friendship.findFirst({
            where: {
                userId: currentUserId,
                friendId: friendId,
            },
        });
        if (existingFriendship) {
            res.json({ status: 'friends' });
            return;
        }
        const existingRequest = await prisma.friendRequest.findFirst({
            where: {
                OR: [
                    { senderId: currentUserId, receiverId: friendId },
                    { senderId: friendId, receiverId: currentUserId },
                ],
                status: "pending",
            },
        });
        if (existingRequest) {
            if (existingRequest.senderId === currentUserId) {
                res.json({ status: 'sent' });
            }
            else {
                res.json({ status: 'received' });
            }
            return;
        }
        res.json({ status: 'none' });
    }
    catch (err) {
        console.error("Error checking friend request status:", err);
        res.status(500).json({ error: "Internal error" });
    }
};
exports.getRequestStatus = getRequestStatus;
const acceptRequest = async (req, res) => {
    const { requestId } = req.body;
    try {
        const request = await prisma.friendRequest.findUnique({
            where: { id: requestId },
        });
        if (!request || request.status !== "pending") {
            res.status(404).json({ error: "Request not found or already handled" });
            return;
        }
        await prisma.friendRequest.update({
            where: { id: requestId },
            data: { status: "accepted" },
        });
        await prisma.friendship.createMany({
            data: [
                { userId: request.senderId, friendId: request.receiverId },
                { userId: request.receiverId, friendId: request.senderId },
            ],
            skipDuplicates: true,
        });
        res.json({ message: "Friend request accepted" });
    }
    catch {
        res.status(500).json({ error: "Accept failed" });
    }
};
exports.acceptRequest = acceptRequest;
const declineRequest = async (req, res) => {
    const { requestId } = req.body;
    try {
        await prisma.friendRequest.delete({ where: { id: requestId } });
        res.status(204).end();
    }
    catch {
        res.status(500).json({ error: "Decline failed" });
    }
};
exports.declineRequest = declineRequest;
const getPendingRequests = async (req, res) => {
    const userId = req.user?.id;
    console.log(userId);
    try {
        const requests = await prisma.friendRequest.findMany({
            where: {
                receiverId: userId,
                status: "pending",
            },
            include: {
                sender: { select: { id: true, username: true, profilePicture: true } },
            },
        });
        console.log(requests);
        res.json(requests);
    }
    catch {
        res.status(500).json({ error: "Fetch failed" });
    }
};
exports.getPendingRequests = getPendingRequests;
const getFriends = async (req, res) => {
    const userId = req.user?.id;
    try {
        const friends = await prisma.friendship.findMany({
            where: { userId },
            include: {
                friend: { select: { id: true, username: true, profilePicture: true } },
            },
        });
        const formatted = friends.map((f) => f.friend);
        res.json(formatted);
    }
    catch {
        res.status(500).json({ error: "List fetch failed" });
    }
};
exports.getFriends = getFriends;
