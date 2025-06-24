// ./routes/userRoutes.ts
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyToken } from "../middlewares/authMiddleware";

const router = express.Router();
const prisma = new PrismaClient();

router.get("/", async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, email: true },
    });
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Internal server error" });
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
  } catch (err) {
    console.error("Error fetching public posts", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("id/:id", async (req: Request, res: Response) => {
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
  } catch (err) {
    console.error("Error fetching user by ID:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:username", async (req: Request, res: Response) => {
  const { username } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        email: true,
        profilePicture: true,
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
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/send-coins", verifyToken, async (req: any, res) => {
  const { recipientId, amount } = req.body;
  const senderId = req.user.id;

  // Validation
  if (!recipientId || !amount) {
    res.status(400).json({ error: "Recipient ID and amount are required" });
    return
  }

  if (typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: "Amount must be a positive number" });
    return
  }

  if (senderId === recipientId) {
    res.status(400).json({ error: "Cannot send coins to yourself" });
    return
  }

  // Round to 2 decimal places to handle floating point precision
  const roundedAmount = Math.round(amount * 100) / 100;

  try {
    // Check if recipient exists
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true, username: true, cyberCoins: true }
    });

    if (!recipient) {
       res.status(404).json({ error: "Recipient not found" });
       return
    }

    // Check sender's balance
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { id: true, username: true, cyberCoins: true }
    });

    if (!sender) {
      res.status(404).json({ error: "Sender not found" });
      return
    }

    if (sender.cyberCoins < roundedAmount) {
       res.status(400).json({ error: "Insufficient cyber coins" });
       return
    }

    // Perform the transaction
    await prisma.$transaction([
      // Deduct from sender
      prisma.user.update({
        where: { id: senderId },
        data: { cyberCoins: { decrement: roundedAmount } }
      }),
      // Add to recipient
      prisma.user.update({
        where: { id: recipientId },
        data: { cyberCoins: { increment: roundedAmount } }
      })
    ]);

    // Get updated balances
    const updatedSender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { cyberCoins: true }
    });

    res.status(200).json({ 
      message: `Successfully sent ${roundedAmount} cyber coins to ${recipient.username}`,
      senderBalance: updatedSender?.cyberCoins,
      amountSent: roundedAmount,
      recipient: recipient.username
    });

  } catch (error) {
    console.error("Failed to send cyber coins:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


router.get("/:username/posts", async (req: Request, res: Response) => {
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
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



export default router;
