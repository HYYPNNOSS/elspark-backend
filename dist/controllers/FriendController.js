"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFriends = exports.getPendingRequests = exports.declineRequest = exports.acceptRequest = exports.sendRequest = void 0;
const client_1 = require("@prisma/client");
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
        // Create bi-directional friendships
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
