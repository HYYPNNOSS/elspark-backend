import 'dotenv/config'
import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import router from "./routes/userRoutes";
import ostrouter from "./routes/postGet";
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
import followRouter from "./routes/followRoutes";
import ffprobe from "ffprobe";
import ffprobeStatic from "ffprobe-static";
import multer from "multer";

import Stripe from 'stripe';
import mooshiRoutes from './routes/mooshi';

import elsparkRoutes from './routes/elsparkRoutes';
import { setupElsparkWebSocket } from './sockets/elspark.socket';







import { setupGameWebSocket } from "./sockets/game.socket";

import friendRoute from "./routes/friendRoutes";
import path from "path";
import adminRoutes from "./routes/adminRoutes";
import notificationsRouter from "./routes/notificationsRoutes";

const stripeApiKey = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("⚠️ STRIPE_SECRET_KEY is missing in environment variables. Stripe payments will fail.");
}
const stripe = new Stripe(stripeApiKey, {
  apiVersion: '2025-08-27.basil',
});


dotenv.config();
const app = express();
const prisma = new PrismaClient();
const server = http.createServer(app);

const allowedOrigins = [
  "https://elspark-frontend.vercel.app",
  'https://elspark.online',
  'https://elspark.online/',
  'http://elspark.online', 
  'https://www.elspark.online', 
  "http://localhost:3000",
  "*",
  "http://192.168.1.4:3000",
  "http://192.168.1.5:3000",
  "http://192.168.1.3:3000",



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
setupElsparkWebSocket(io);


app.use(express.json());
app.use("/api/users", router);
app.use('/api/admin', adminRoutes); 

app.use("/api/auth", authRoutes);
app.use("/api/follow", followRouter);

app.use("/api/ost", ostrouter)



app.use("/api/messages", userMessages);
app.use("/api/posts", postRoutes);
app.use("/api/comments", commentsRouter);
app.use("/api/coins", coinsRoute);
app.use("/api/friend/", friendRoute);
app.use("/api/postCoowners/", cooRoute);
app.use("/api/notifications/", notificationsRouter);
app.use("/api", postCollections);
app.use("/uploads", express.static("uploads"));
app.use("/api/ai-sessions", aiSessionsRoute);
app.use("/api/ai-chat", aiChatRoute);
app.use("/api/ai-messages", aiMessagesRoute);
app.use('/api/mooshi', mooshiRoutes);
app.use('/api/elspark', elsparkRoutes);


app.get('/ping', (req, res) => {
  res.json({ status: 'alive', time: new Date() });
});
app.use("/videos", express.static(path.join(__dirname, "livevid")));


app.get('/api/chat/connection/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const connection = await prisma.chatConnection.findFirst({
      where: {
        OR: [
          { user1Id: parseInt(userId) },
          { user2Id: parseInt(userId) }
        ],
        status: 'ACTIVE'
      },
      include: {
        user1: { select: { id: true, username: true, profilePicture: true, online: true } },
        user2: { select: { id: true, username: true, profilePicture: true, online: true } }
      }
    });

    if (connection) {
      const partnerId = connection.user1Id === parseInt(userId) ? connection.user2Id : connection.user1Id;
      const partnerInfo = connection.user1Id === parseInt(userId) ? connection.user2 : connection.user1;
      
      res.json({
        hasConnection: true,
        roomId: connection.roomId,
        partnerId,
        partnerInfo,
        bothOnline: connection.user1.online && connection.user2.online
      });
    } else {
      res.json({ hasConnection: false });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to check connection' });
  }
});

app.post('/api/chat/end/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const connection = await prisma.chatConnection.updateMany({
      where: {
        OR: [
          { user1Id: parseInt(userId) },
          { user2Id: parseInt(userId) }
        ],
        status: 'ACTIVE'
      },
      data: {
        status: 'ENDED',
        endedAt: new Date()
      }
    });

    res.json({ success: true, ended: connection.count > 0 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to end connection' });
  }
});

app.get('/api/chat/messages/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    res.json({ messages: [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get messages' });
  }
});


app.post('/api/coins/create-payment-intent', async (req, res) => {
  try {
    const { amount, coinAmount, userId } = req.body;
    
const profile = await prisma.profile.findUnique({
  where: { id: userId },
  include: { account: true }
});

if (!profile) {
  res.status(404).json({ error: 'Profile not found' });
  return;
}

const paymentIntent = await stripe.paymentIntents.create({
  amount: amount * 100,
  currency: 'gbp',
  metadata: {
    accountId: profile.accountId.toString(),
    coinAmount: coinAmount.toString(),
  },
  automatic_payment_methods: {
    enabled: true,
  },
});
    
    
    
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

app.post('/api/coins/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      
      try {
const accountId = parseInt(paymentIntent.metadata.accountId);
const coinAmount = parseInt(paymentIntent.metadata.coinAmount);

const updatedAccount = await prisma.account.update({
  where: { id: accountId },
  data: {
    cyberCoins: {
      increment: coinAmount
    }
  }
});

await prisma.coinTransaction.create({
  data: {
    accountId: accountId,
    amount: coinAmount,
    priceGBP: paymentIntent.amount / 100,
    stripePaymentIntentId: paymentIntent.id,
    status: 'completed'
  }
});

console.log(`Payment succeeded for account ${accountId}: +${coinAmount} coins`);
      } catch (error) {
        console.error('Error processing successful payment:', error);
      }
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object as Stripe.PaymentIntent;
      console.log('Payment failed:', failedPayment.id);
      
      try {
        const userId = parseInt(failedPayment.metadata.userId);
        await prisma.coinTransaction.create({
          data: {
            accountId: parseInt(failedPayment.metadata.accountId),
            amount: parseInt(failedPayment.metadata.coinAmount),
            priceGBP: failedPayment.amount / 100,
            stripePaymentIntentId: failedPayment.id,
            status: 'failed'
          }
        });
      } catch (error) {
        console.error('Error logging failed payment:', error);
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

app.get('/api/coins/transactions/:accountId', async (req, res) => {
  try {
    const accountId = parseInt(req.params.accountId);
    
    const transactions = await prisma.coinTransaction.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

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
  limits: { fileSize: 500 * 1024 * 1024 },
});





app.post("/api/tv/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No video file uploaded" });
      return;
    }

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

loadPlaylist();

class TVController {
  private videoDurations: Map<string, number>;
  private intervalId: NodeJS.Timeout | null;

  constructor() {
    this.videoDurations = new Map();
    this.intervalId = null;
    this.startContinuousPlayback();
  }

  startContinuousPlayback(): void {
    this.intervalId = setInterval(() => {
      this.updatePlaybackState();
    }, 1000);
  }

  updatePlaybackState(): void {
    if (currentState.playlist.length === 0) return;

    const now = Date.now();
    const elapsed = (now - currentState.startTime) / 1000;

    const totalPlaylistDuration = currentState.playlist.reduce(
      (sum, video) => sum + (video.duration || 0),
      0
    );

    let cycleTime = elapsed % totalPlaylistDuration;

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


function getRandomColor(): string {
  const colors = ["red", "green", "blue", "yellow"];
  return colors[Math.floor(Math.random() * colors.length)];
}


const persistentConnections = new Map();
const roomPresence = new Map();

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

    io.emit("newMessage", message);
  });

  socket.on("requestSync", () => {
    socket.emit("syncState", tvController.getCurrentState());
  });

  socket.on("user_connected", async (profileId: number) => {
    console.log("Profile connected with ID:", profileId);
  
    if (!profileId || typeof profileId !== "number") {
      console.error("Invalid profileId received:", profileId);
      return;
    }
  
    onlineUsers.set(profileId, socket.id);
  
    await prisma.profile.update({
      where: { id: profileId },
      data: { online: true },
    });
  
    const existingConnection = persistentConnections.get(profileId);
    if (existingConnection && existingConnection.status === 'active') {
      const { partnerId, roomId } = existingConnection;
      
      socket.join(roomId);
      activeRooms.set(profileId , roomId);
      
      if (!roomPresence.has(roomId)) roomPresence.set(roomId, new Set());
      roomPresence.get(roomId).add(profileId);
      
      socket.emit("reconnected_to_existing", { partnerId, roomId });
      
      const partnerSocketId = onlineUsers.get(partnerId);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit("partner_back_online", { partnerId: profileId });
      }
    }
  
    const users = await prisma.profile.findMany({
      select: { id: true, username: true, profilePicture: true, online: true },
    });
  
    io.emit("online_users", users);
    socket.emit("all_users", users);
  });

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

socket.on("start_looking", async (profileId: number) => {
  if (!profileId || typeof profileId !== "number") {
    console.error("Invalid profileId received:", profileId);
    return;
  }

  const existingConnection = persistentConnections.get(profileId);
  if (existingConnection && existingConnection.status === 'active') {
    console.log("Profile already has active connection, not adding to queue");
    return;
  }

  await prisma.profile.update({
    where: { id: profileId },
    data: { looking: true },
  });

  if (!lookingQueue.includes(profileId)) lookingQueue.push(profileId);

  if (lookingQueue.length >= 2) {
    const [profile1, profile2] = lookingQueue.splice(0, 2);
    const roomId = `room-${profile1}-${profile2}-${Date.now()}`;

    activeRooms.set(profile1, roomId);
    activeRooms.set(profile2, roomId);

    persistentConnections.set(profile1, { 
      partnerId: profile2, 
      roomId, 
      createdAt: Date.now(), 
      status: 'active' 
    });
    persistentConnections.set(profile2, { 
      partnerId: profile1, 
      roomId, 
      createdAt: Date.now(), 
      status: 'active' 
    });

    const socket1 = onlineUsers.get(profile1);
    const socket2 = onlineUsers.get(profile2);

    if (socket1) {
      io.to(socket1).emit("matched", { partnerId: profile2, roomId });
    }

    if (socket2) {
      io.to(socket2).emit("matched", { partnerId: profile1, roomId });
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

socket.on("join_room", (roomId: string) => {
  socket.join(roomId);
  
  if (!roomPresence.has(roomId)) roomPresence.set(roomId, new Set());
  
  let currentUserId = null;
  for (const [userId, socketId] of onlineUsers.entries()) {
    if (socketId === socket.id) {
      currentUserId = userId;
      break;
    }
  }
  
  if (currentUserId) {
    roomPresence.get(roomId).add(currentUserId);
    
    const usersInRoom = Array.from(roomPresence.get(roomId));
    socket.to(roomId).emit("room_presence_updated", { 
      usersInRoom, 
      bothPresent: usersInRoom.length >= 2 
    });
    
    socket.emit("room_presence_updated", { 
      usersInRoom, 
      bothPresent: usersInRoom.length >= 2 
    });
  }
});

socket.on("send_message", ({ roomId, message }) => {
  const usersInRoom = roomPresence.get(roomId);
  const bothPresent = usersInRoom && usersInRoom.size >= 2;
  
  if (bothPresent) {
    socket.to(roomId).emit("receive_message", message);
    socket.emit("message_sent", { success: true });
  } else {
    socket.emit("message_sent", { 
      success: false, 
      reason: "Partner is not currently in the chat room" 
    });
  }
});

  socket.on("skip", async (profileId: number) => {
    const roomId = activeRooms.get(profileId);
    const connection = persistentConnections.get(profileId);
    if (connection && connection.status === 'active') {
      const { partnerId } = connection;
      
      persistentConnections.set(profileId, { ...connection, status: 'ended' });
      const partnerConnection = persistentConnections.get(partnerId);
      if (partnerConnection) {
        persistentConnections.set(partnerId, { ...partnerConnection, status: 'ended' });
      }
      
      if (roomId) {
        roomPresence.delete(roomId);
      }
    }
  
    if (roomId) {
      io.to(roomId).emit("chat_ended");
  
      for (const [uid, rid] of activeRooms.entries()) {
        if (rid === roomId) activeRooms.delete(uid);
      }
    }
  
    if (!lookingQueue.includes(profileId)) lookingQueue.push(profileId);
    io.emit("looking_updated", lookingQueue);
  });

socket.on("check_existing_connection", (profileId: number) => {
  const connection = persistentConnections.get(profileId);
  
  if (connection && connection.status === 'active') {
    const { partnerId, roomId } = connection;
    
    socket.join(roomId);
    activeRooms.set(profileId, roomId);
    
    if (!roomPresence.has(roomId)) roomPresence.set(roomId, new Set());
    roomPresence.get(roomId).add(profileId);
    
    const partnerOnline = onlineUsers.has(partnerId);
    const usersInRoom = Array.from(roomPresence.get(roomId));
    
    socket.emit("existing_connection_found", {
      partnerId,
      roomId,
      partnerOnline,
      bothInRoom: usersInRoom.length >= 2
    });
  } else {
    socket.emit("no_existing_connection");
  }
});

socket.on("disconnect", async () => {
  let disconnectedProfileId: number | null = null;

  for (const [profileId, socketId] of onlineUsers.entries()) {
    if (socketId === socket.id) {
      onlineUsers.delete(profileId);
      disconnectedProfileId = profileId;
      break;
    }
  }

  if (disconnectedProfileId !== null) {
    await prisma.profile.update({
      where: { id: disconnectedProfileId },
      data: { online: false, looking: false },
    });

    const connection = persistentConnections.get(disconnectedProfileId);
    const roomId = activeRooms.get(disconnectedProfileId);
    
    if (roomId && connection?.status === 'active') {
      const usersInRoom = roomPresence.get(roomId);
      if (usersInRoom) {
        usersInRoom.delete(disconnectedProfileId);
        
        socket.to(roomId).emit("partner_left_room", { partnerId: disconnectedProfileId });
      }
    }

    const index = lookingQueue.indexOf(disconnectedProfileId);
    if (index !== -1) lookingQueue.splice(index, 1);
  }

  const users = await prisma.profile.findMany({
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
