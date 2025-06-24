"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const socket_io_1 = require("socket.io");
const client_1 = require("@prisma/client");
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const userMessages_1 = __importDefault(require("./routes/userMessages"));
const postRoutes_1 = __importDefault(require("./routes/postRoutes"));
const comments_1 = __importDefault(require("./routes/comments"));
const coins_1 = __importDefault(require("./routes/coins"));
const postCoowners_1 = __importDefault(require("./routes/postCoowners"));
const postCollections_1 = __importDefault(require("./routes/postCollections"));
const game_socket_1 = require("./sockets/game.socket");
const friendRoutes_1 = __importDefault(require("./routes/friendRoutes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const server = http_1.default.createServer(app);
const allowedOrigin = 'http://localhost:3000';
app.use((0, cors_1.default)({
    origin: allowedOrigin,
    credentials: true,
}));
const io = new socket_io_1.Server(server, {
    cors: {
        origin: allowedOrigin,
        methods: ['GET', 'POST'],
        credentials: true,
    },
});
(0, game_socket_1.setupGameWebSocket)(io);
app.use(express_1.default.json());
app.use('/api/users', userRoutes_1.default);
app.use('/api/auth', authRoutes_1.default);
app.use('/api/messages', userMessages_1.default);
app.use('/api/posts', postRoutes_1.default);
app.use('/api/comments', comments_1.default);
app.use('/api/coins', coins_1.default);
app.use('/api/friend/', friendRoutes_1.default);
app.use('/api/postCoowners/', postCoowners_1.default);
app.use('/api', postCollections_1.default);
app.use('/uploads', express_1.default.static('uploads'));
const onlineUsers = new Map();
const corneredQueue = [];
function checkForCorneredMatch() {
    const ROOM_SIZE = 4;
    while (corneredQueue.length >= ROOM_SIZE) {
        const players = corneredQueue.splice(0, ROOM_SIZE);
        const roomId = `cornered-room-${Date.now()}`;
        players.forEach((p) => io.to(p.socketId).emit('cornered_match_found', { roomId, players }));
    }
    if (corneredQueue.length > 0 && corneredQueue.length < ROOM_SIZE) {
        setTimeout(() => {
            if (corneredQueue.length > 0 && corneredQueue.length < ROOM_SIZE) {
                const players = [...corneredQueue];
                corneredQueue.length = 0;
                while (players.length < ROOM_SIZE) {
                    players.push({
                        socketId: `bot-${Date.now()}-${Math.random()}`,
                        color: getRandomColor(),
                    });
                }
                const roomId = `cornered-room-${Date.now()}`;
                players.forEach((p) => {
                    if (!p.socketId.startsWith('bot-')) {
                        io.to(p.socketId).emit('cornered_match_found', {
                            roomId,
                            players,
                        });
                    }
                });
            }
        }, 5000);
    }
}
function getRandomColor() {
    const colors = ['red', 'green', 'blue', 'yellow'];
    return colors[Math.floor(Math.random() * colors.length)];
}
// userId -> socketId
// ========== Random Chat Logic ==========
const lookingQueue = [];
const activeRooms = new Map();
io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);
    // Handle user connection
    socket.on('user_connected', async (userId) => {
        console.log('MFucking User connected with ID:', userId);
        if (!userId || typeof userId !== 'number') {
            console.error('Mfucking Invalid userId received:', userId);
            return;
        }
        onlineUsers.set(userId, socket.id);
        await prisma.user.update({
            where: { id: userId },
            data: { online: true }
        });
        const users = await prisma.user.findMany({
            select: { id: true, username: true, profilePicture: true, online: true }
        });
        io.emit('online_users', users);
        socket.emit('all_users', users);
    });
    // ========== Private Message ==========
    socket.on('private_message', async ({ from, to, content }) => {
        const newMessage = await prisma.message.create({
            data: {
                senderId: from,
                receiverId: to,
                content,
            },
        });
        const message = {
            id: newMessage.id,
            content: newMessage.content,
            senderId: from,
            receiverId: to,
            createdAt: newMessage.createdAt,
        };
        const toSocket = onlineUsers.get(to);
        if (toSocket)
            io.to(toSocket).emit('private_message', message);
        const fromSocket = onlineUsers.get(from);
        if (fromSocket)
            io.to(fromSocket).emit('private_message', message);
    });
    // ========== Random Match ==========
    socket.on('start_looking', async (userId) => {
        if (!userId || typeof userId !== 'number') {
            console.error('Invalid userId received:', userId);
            return;
        }
        await prisma.user.update({
            where: { id: userId },
            data: { looking: true }
        });
        if (!lookingQueue.includes(userId))
            lookingQueue.push(userId);
        if (lookingQueue.length >= 2) {
            const [user1, user2] = lookingQueue.splice(0, 2); // get 2 users
            const roomId = `room-${user1}-${user2}-${Date.now()}`;
            activeRooms.set(user1, roomId);
            activeRooms.set(user2, roomId);
            const socket1 = onlineUsers.get(user1);
            const socket2 = onlineUsers.get(user2);
            if (socket1) {
                io.to(socket1).emit('matched', { partnerId: user2, roomId });
            }
            if (socket2) {
                io.to(socket2).emit('matched', { partnerId: user1, roomId });
            }
        }
    });
    socket.on('skip', async (userId) => {
        const roomId = activeRooms.get(userId);
        if (roomId) {
            io.to(roomId).emit('chat_ended');
            for (const [uid, rid] of activeRooms.entries()) {
                if (rid === roomId)
                    activeRooms.delete(uid);
            }
        }
        if (!lookingQueue.includes(userId))
            lookingQueue.push(userId);
        io.emit('looking_updated', lookingQueue);
    });
    // Join room
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
    });
    // Send message in room
    socket.on('send_message', ({ roomId, message }) => {
        socket.to(roomId).emit('receive_message', message); // only sends to *other* clients in the room
    });
    // Skip current chat
    socket.on('skip', async (userId) => {
        const roomId = activeRooms.get(userId);
        if (roomId) {
            io.to(roomId).emit('chat_ended');
            for (const [uid, rid] of activeRooms.entries()) {
                if (rid === roomId)
                    activeRooms.delete(uid);
            }
        }
        if (!lookingQueue.includes(userId))
            lookingQueue.push(userId);
        io.emit('looking_updated', lookingQueue);
    });
    // ========== Handle Disconnect ==========
    socket.on('disconnect', async () => {
        let disconnectedUserId = null;
        for (const [userId, socketId] of onlineUsers.entries()) {
            if (socketId === socket.id) {
                onlineUsers.delete(userId);
                disconnectedUserId = userId;
                break;
            }
        }
        if (disconnectedUserId !== null) {
            await prisma.user.update({
                where: { id: disconnectedUserId },
                data: { online: false, looking: false }
            });
            const roomId = activeRooms.get(disconnectedUserId);
            if (roomId) {
                io.to(roomId).emit('chat_ended');
                for (const [uid, rid] of activeRooms.entries()) {
                    if (rid === roomId)
                        activeRooms.delete(uid);
                }
            }
            const index = lookingQueue.indexOf(disconnectedUserId);
            if (index !== -1)
                lookingQueue.splice(index, 1);
        }
        const users = await prisma.user.findMany({
            select: { id: true, username: true, profilePicture: true, online: true }
        });
        io.emit('online_users', users);
    });
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
