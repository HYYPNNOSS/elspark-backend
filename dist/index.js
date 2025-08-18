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
const fs_1 = __importDefault(require("fs"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const userMessages_1 = __importDefault(require("./routes/userMessages"));
const postRoutes_1 = __importDefault(require("./routes/postRoutes"));
const comments_1 = __importDefault(require("./routes/comments"));
const coins_1 = __importDefault(require("./routes/coins"));
const postCoowners_1 = __importDefault(require("./routes/postCoowners"));
const postCollections_1 = __importDefault(require("./routes/postCollections"));
const aiSessions_1 = __importDefault(require("./routes/aiSessions"));
const aiChat_1 = __importDefault(require("./routes/aiChat"));
const aiMessages_1 = __importDefault(require("./routes/aiMessages"));
// import ffmpeg from 'fluent-ffmpeg';
const ffprobe_1 = __importDefault(require("ffprobe"));
const ffprobe_static_1 = __importDefault(require("ffprobe-static"));
const multer_1 = __importDefault(require("multer"));
// import MP4Box from 'mp4box';
const game_socket_1 = require("./sockets/game.socket");
const friendRoutes_1 = __importDefault(require("./routes/friendRoutes"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const server = http_1.default.createServer(app);
const allowedOrigins = [
    "https://elspark-frontend.vercel.app",
    "http://localhost:3000",
];
app.use((0, cors_1.default)({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
}));
const io = new socket_io_1.Server(server, {
    cors: {
        origin: function (origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            }
            else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        methods: ["GET", "POST"],
        credentials: true,
    },
});
(0, game_socket_1.setupGameWebSocket)(io);
app.use(express_1.default.json());
app.use("/api/users", userRoutes_1.default);
app.use("/api/auth", authRoutes_1.default);
app.use("/api/messages", userMessages_1.default);
app.use("/api/posts", postRoutes_1.default);
app.use("/api/comments", comments_1.default);
app.use("/api/coins", coins_1.default);
app.use("/api/friend/", friendRoutes_1.default);
app.use("/api/postCoowners/", postCoowners_1.default);
app.use("/api", postCollections_1.default);
app.use("/uploads", express_1.default.static("uploads"));
app.use("/api/ai-sessions", aiSessions_1.default);
app.use("/api/ai-chat", aiChat_1.default);
app.use("/api/ai-messages", aiMessages_1.default);
app.use("/videos", express_1.default.static(path_1.default.join(__dirname, "livevid")));
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path_1.default.join(__dirname, "livevid"));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + "-" + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /mp4|webm|ogg|avi|mov/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error("Only video files are allowed"));
        }
    },
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});
app.post("/api/tv/upload", upload.single("video"), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: "No video file uploaded" });
            return;
        }
        // Reload playlist to include new video
        await loadPlaylist();
        res.json({
            success: true,
            filename: req.file.filename,
            message: "Video uploaded successfully",
        });
    }
    catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: "Upload failed" });
    }
});
const livevidDir = path_1.default.join(__dirname, "livevid");
if (!fs_1.default.existsSync(livevidDir)) {
    fs_1.default.mkdirSync(livevidDir, { recursive: true });
}
// Global state for the TV
let currentState = {
    currentVideoIndex: 0,
    currentTime: 0,
    isPlaying: true,
    playlist: [],
    startTime: Date.now(),
};
async function getMP4Duration(filePath) {
    const info = await (0, ffprobe_1.default)(filePath, { path: ffprobe_static_1.default.path });
    const duration = info.streams[0].duration;
    return duration ? parseFloat(duration) : 0;
}
// Load video playlist
async function loadPlaylist() {
    const videoDir = path_1.default.join(__dirname, "livevid");
    try {
        const files = fs_1.default.readdirSync(videoDir).filter((file) => {
            const ext = path_1.default.extname(file).toLowerCase();
            return [".mp4", ".webm", ".ogg", ".avi", ".mov"].includes(ext);
        });
        const playlist = [];
        for (const file of files) {
            const duration = await getMP4Duration(path_1.default.join(videoDir, file));
            playlist.push({
                filename: file,
                url: `/videos/${file}`,
                duration,
            });
        }
        currentState.playlist = playlist;
        console.log(`Loaded ${playlist.length} videos`);
    }
    catch (error) {
        console.error("Error loading playlist:", error);
        currentState.playlist = [];
    }
}
// Initialize playlist
loadPlaylist();
// TV controller - manages video progression
class TVController {
    constructor() {
        this.videoDurations = new Map(); // Store video durations
        this.intervalId = null;
        this.startContinuousPlayback();
    }
    startContinuousPlayback() {
        // Update every second to sync clients
        this.intervalId = setInterval(() => {
            this.updatePlaybackState();
        }, 1000);
    }
    updatePlaybackState() {
        if (currentState.playlist.length === 0)
            return;
        const now = Date.now();
        const elapsed = (now - currentState.startTime) / 1000;
        // Calculate total playlist duration with actual video lengths
        const totalPlaylistDuration = currentState.playlist.reduce((sum, video) => sum + (video.duration || 0), 0);
        let cycleTime = elapsed % totalPlaylistDuration;
        // Find which video we're on based on real durations
        let accumulated = 0;
        for (let i = 0; i < currentState.playlist.length; i++) {
            const video = currentState.playlist[i];
            const dur = video.duration || 0;
            if (cycleTime < accumulated + dur) {
                currentState.currentVideoIndex = i;
                currentState.currentTime = cycleTime - accumulated;
                break;
            }
            accumulated += dur;
        }
        io.emit("videoChanged", {
            videoIndex: currentState.currentVideoIndex,
            currentTime: currentState.currentTime,
            video: currentState.playlist[currentState.currentVideoIndex],
        });
    }
    getCurrentState() {
        return {
            ...currentState,
            currentVideo: currentState.playlist[currentState.currentVideoIndex] || null,
        };
    }
}
const tvController = new TVController();
const onlineUsers = new Map();
const corneredQueue = [];
// function checkForCorneredMatch() {
//   const ROOM_SIZE = 4;
//   while (corneredQueue.length >= ROOM_SIZE) {
//     const players = corneredQueue.splice(0, ROOM_SIZE);
//     const roomId = `cornered-room-${Date.now()}`;
//     players.forEach((p) =>
//       io.to(p.socketId).emit('cornered_match_found', { roomId, players })
//     );
//   }
//   if (corneredQueue.length > 0 && corneredQueue.length < ROOM_SIZE) {
//     setTimeout(() => {
//       if (corneredQueue.length > 0 && corneredQueue.length < ROOM_SIZE) {
//         const players = [...corneredQueue];
//         corneredQueue.length = 0;
//         while (players.length < ROOM_SIZE) {
//           players.push({
//             socketId: `bot-${Date.now()}-${Math.random()}`,
//             color: getRandomColor(),
//           });
//         }
//         const roomId = `cornered-room-${Date.now()}`;
//         players.forEach((p) => {
//           if (!p.socketId.startsWith('bot-')) {
//             io.to(p.socketId).emit('cornered_match_found', {
//               roomId,
//               players,
//             });
//           }
//         });
//       }
//     }, 5000);
//   }
// }
function getRandomColor() {
    const colors = ["red", "green", "blue", "yellow"];
    return colors[Math.floor(Math.random() * colors.length)];
}
// userId -> socketId
// ========== Random Chat Logic ==========
const lookingQueue = [];
const activeRooms = new Map();
io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);
    socket.emit("initialState", tvController.getCurrentState());
    socket.on("chatMessage", (data) => {
        const message = {
            id: Date.now(),
            username: data.username || "Anonymous",
            message: data.message,
            timestamp: new Date().toISOString(),
        };
        // Broadcast to all clients
        io.emit("newMessage", message);
    });
    // Handle sync requests
    socket.on("requestSync", () => {
        socket.emit("syncState", tvController.getCurrentState());
    });
    // Handle user connection
    socket.on("user_connected", async (userId) => {
        console.log("MFucking User connected with ID:", userId);
        if (!userId || typeof userId !== "number") {
            console.error("Mfucking Invalid userId received:", userId);
            return;
        }
        onlineUsers.set(userId, socket.id);
        await prisma.user.update({
            where: { id: userId },
            data: { online: true },
        });
        const users = await prisma.user.findMany({
            select: { id: true, username: true, profilePicture: true, online: true },
        });
        io.emit("online_users", users);
        socket.emit("all_users", users);
    });
    // ========== Private Message ==========
    socket.on("private_message", async ({ from, to, content }) => {
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
            io.to(toSocket).emit("private_message", message);
        const fromSocket = onlineUsers.get(from);
        if (fromSocket)
            io.to(fromSocket).emit("private_message", message);
    });
    // ========== Random Match ==========
    socket.on("start_looking", async (userId) => {
        if (!userId || typeof userId !== "number") {
            console.error("Invalid userId received:", userId);
            return;
        }
        await prisma.user.update({
            where: { id: userId },
            data: { looking: true },
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
                io.to(socket1).emit("matched", { partnerId: user2, roomId });
            }
            if (socket2) {
                io.to(socket2).emit("matched", { partnerId: user1, roomId });
            }
        }
    });
    socket.on("skip", async (userId) => {
        const roomId = activeRooms.get(userId);
        if (roomId) {
            io.to(roomId).emit("chat_ended");
            for (const [uid, rid] of activeRooms.entries()) {
                if (rid === roomId)
                    activeRooms.delete(uid);
            }
        }
        if (!lookingQueue.includes(userId))
            lookingQueue.push(userId);
        io.emit("looking_updated", lookingQueue);
    });
    // Join room
    socket.on("join_room", (roomId) => {
        socket.join(roomId);
    });
    // Send message in room
    socket.on("send_message", ({ roomId, message }) => {
        socket.to(roomId).emit("receive_message", message); // only sends to *other* clients in the room
    });
    // Skip current chat
    socket.on("skip", async (userId) => {
        const roomId = activeRooms.get(userId);
        if (roomId) {
            io.to(roomId).emit("chat_ended");
            for (const [uid, rid] of activeRooms.entries()) {
                if (rid === roomId)
                    activeRooms.delete(uid);
            }
        }
        if (!lookingQueue.includes(userId))
            lookingQueue.push(userId);
        io.emit("looking_updated", lookingQueue);
    });
    // ========== Handle Disconnect ==========
    socket.on("disconnect", async () => {
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
                data: { online: false, looking: false },
            });
            const roomId = activeRooms.get(disconnectedUserId);
            if (roomId) {
                io.to(roomId).emit("chat_ended");
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
            select: { id: true, username: true, profilePicture: true, online: true },
        });
        io.emit("online_users", users);
    });
});
app.get("/api/tv/status", (req, res) => {
    res.json(tvController.getCurrentState());
});
app.get("/api/tv/playlist", (req, res) => {
    res.json(currentState.playlist);
});
app.post("/api/tv/reload-playlist", (req, res) => {
    loadPlaylist();
    res.json({ success: true, playlist: currentState.playlist });
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
