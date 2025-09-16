import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: { id: number };
}

export const sendRequest = async (req: AuthRequest, res: Response) => {
  // console.log("mousa")
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
  } catch (err) {
    res.status(500).json({ error: "Internal error" });
  }
};

export const acceptRequest = async (req: AuthRequest, res: Response) => {
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
  } catch {
    res.status(500).json({ error: "Accept failed" });
  }
};

export const declineRequest = async (req: AuthRequest, res: Response) => {
  const { requestId } = req.body;

  try {
    await prisma.friendRequest.delete({ where: { id: requestId } });
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Decline failed" });
  }
};

export const getPendingRequests = async (req: AuthRequest, res: Response) => {
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
  } catch {
    res.status(500).json({ error: "Fetch failed" });
  }
};

export const getFriends = async (req: AuthRequest, res: Response) => {
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
  } catch {
    res.status(500).json({ error: "List fetch failed" });
  }
};
