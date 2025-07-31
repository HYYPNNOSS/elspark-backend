import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import router from "./routes/userRoutes";
import authRoutes from "./routes/authRoutes";
import userMessages from "./routes/userMessages";
import postRoutes from "./routes/postRoutes";
import commentsRouter from "./routes/comments";
import coinsRoute from "./routes/coins";
import cooRoute from "./routes/postCoowners";
import postCollections from "./routes/postCollections";
import aiSessionsRoute from "./routes/aiSessions";
import aiChatRoute from "./routes/aiChat";
import aiMessagesRoute from "./routes/aiMessages";
// import ffmpeg from 'fluent-ffmpeg';
import ffprobe from "ffprobe";
import ffprobeStatic from "ffprobe-static";
import multer from "multer";

// import MP4Box from 'mp4box';

import { setupGameWebSocket } from "./sockets/game.socket";

import friendRoute from "./routes/friendRoutes";
import path from "path";

dotenv.config();
const app = express();
const prisma = new PrismaClient();
const server = http.createServer(app);

const allowedOrigins = [
  "https://elspark-frontend.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

setupGameWebSocket(io);

app.use(express.json());
app.use("/api/users", router);
app.use("/api/auth", authRoutes);
app.use("/api/messages", userMessages);
app.use("/api/posts", postRoutes);
app.use("/api/comments", commentsRouter);
app.use("/api/coins", coinsRoute);
app.use("/api/friend/", friendRoute);
app.use("/api/postCoowners/", cooRoute);
app.use("/api", postCollections);
app.use("/uploads", express.static("uploads"));
app.use("/api/ai-sessions", aiSessionsRoute);
app.use("/api/ai-chat", aiChatRoute);
app.use("/api/ai-messages", aiMessagesRoute);

app.use("/videos", express.static(path.join(__dirname, "livevid")));

// Define types
interface VideoInfo {
  filename: string;
  url: string;
  duration: number | null;
}

interface TVState {
  currentVideoIndex: number;
  currentTime: number;
  isPlaying: boolean;
  playlist: VideoInfo[];
  startTime: number;
}

interface ChatMessage {
  id: number;
  username: string;
  message: string;
  timestamp: string;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "livevid"));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|webm|ogg|avi|mov/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
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
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

const livevidDir = path.join(__dirname, "livevid");
if (!fs.existsSync(livevidDir)) {
  fs.mkdirSync(livevidDir, { recursive: true });
}

// Global state for the TV
let currentState: TVState = {
  currentVideoIndex: 0,
  currentTime: 0,
  isPlaying: true,
  playlist: [],
  startTime: Date.now(),
};

async function getMP4Duration(filePath: string): Promise<number> {
  const info = await ffprobe(filePath, { path: ffprobeStatic.path });
  const duration = info.streams[0].duration;
  return duration ? parseFloat(duration) : 0;
}

// Load video playlist
async function loadPlaylist(): Promise<void> {
  const videoDir = path.join(__dirname, "livevid");
  try {
    const files = fs.readdirSync(videoDir).filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".mp4", ".webm", ".ogg", ".avi", ".mov"].includes(ext);
    });

    const playlist: VideoInfo[] = [];
    for (const file of files) {
      const duration = await getMP4Duration(path.join(videoDir, file));
      playlist.push({
        filename: file,
        url: `/videos/${file}`,
        duration,
      });
    }

    currentState.playlist = playlist;
    console.log(`Loaded ${playlist.length} videos`);
  } catch (error) {
    console.error("Error loading playlist:", error);
    currentState.playlist = [];
  }
}

// Initialize playlist
loadPlaylist();

// TV controller - manages video progression
class TVController {
  private videoDurations: Map<string, number>;
  private intervalId: NodeJS.Timeout | null;

  constructor() {
    this.videoDurations = new Map(); // Store video durations
    this.intervalId = null;
    this.startContinuousPlayback();
  }

  startContinuousPlayback(): void {
    // Update every second to sync clients
    this.intervalId = setInterval(() => {
      this.updatePlaybackState();
    }, 1000);
  }

  updatePlaybackState(): void {
    if (currentState.playlist.length === 0) return;

    const now = Date.now();
    const elapsed = (now - currentState.startTime) / 1000;

    // Calculate total playlist duration with actual video lengths
    const totalPlaylistDuration = currentState.playlist.reduce(
      (sum, video) => sum + (video.duration || 0),
      0
    );

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

  getCurrentState(): TVState & { currentVideo: VideoInfo | null } {
    return {
      ...currentState,
      currentVideo:
        currentState.playlist[currentState.currentVideoIndex] || null,
    };
  }
}

const tvController = new TVController();

const onlineUsers = new Map<number, string>();

interface Player {
  socketId: string;
  color: string;
}

const corneredQueue: Player[] = [];

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

function getRandomColor(): string {
  const colors = ["red", "green", "blue", "yellow"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// userId -> socketId

// ========== Random Chat Logic ==========
const lookingQueue: number[] = [];
const activeRooms = new Map<number, string>();

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.emit("initialState", tvController.getCurrentState());

  socket.on("chatMessage", (data: { username?: string; message: string }) => {
    const message: ChatMessage = {
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
  socket.on("user_connected", async (userId: number) => {
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
    if (toSocket) io.to(toSocket).emit("private_message", message);

    const fromSocket = onlineUsers.get(from);
    if (fromSocket) io.to(fromSocket).emit("private_message", message);
  });

  // ========== Random Match ==========
  socket.on("start_looking", async (userId: number) => {
    if (!userId || typeof userId !== "number") {
      console.error("Invalid userId received:", userId);
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { looking: true },
    });

    if (!lookingQueue.includes(userId)) lookingQueue.push(userId);

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

  socket.on("skip", async (userId: number) => {
    const roomId = activeRooms.get(userId);

    if (roomId) {
      io.to(roomId).emit("chat_ended");

      for (const [uid, rid] of activeRooms.entries()) {
        if (rid === roomId) activeRooms.delete(uid);
      }
    }

    if (!lookingQueue.includes(userId)) lookingQueue.push(userId);
    io.emit("looking_updated", lookingQueue);
  });

  // Join room
  socket.on("join_room", (roomId: string) => {
    socket.join(roomId);
  });

  // Send message in room
  socket.on("send_message", ({ roomId, message }) => {
    socket.to(roomId).emit("receive_message", message); // only sends to *other* clients in the room
  });

  // Skip current chat
  socket.on("skip", async (userId: number) => {
    const roomId = activeRooms.get(userId);

    if (roomId) {
      io.to(roomId).emit("chat_ended");
      for (const [uid, rid] of activeRooms.entries()) {
        if (rid === roomId) activeRooms.delete(uid);
      }
    }

    if (!lookingQueue.includes(userId)) lookingQueue.push(userId);
    io.emit("looking_updated", lookingQueue);
  });

  // ========== Handle Disconnect ==========
  socket.on("disconnect", async () => {
    let disconnectedUserId: number | null = null;

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
          if (rid === roomId) activeRooms.delete(uid);
        }
      }

      const index = lookingQueue.indexOf(disconnectedUserId);
      if (index !== -1) lookingQueue.splice(index, 1);
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

const PORT = process.env.PORT || 9001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
