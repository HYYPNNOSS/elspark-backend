import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const notificationsRouter = Router();

interface AuthRequest extends Request {
  user?: { id: number; profileId: number; username: string };
}

const verifyToken = (req: any, res: any, next: any) => {
  next();
};

notificationsRouter.get("/all", async (req: any, res) => {
  const profileId = parseInt(req.query.userId as string);

  if (!profileId || isNaN(profileId)) {
    res.status(400).json({ error: "Valid profileId is required" });
    return;
  }

  try {
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const notifications = await prisma.notification.findMany({
      where: { profileId: profileId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

notificationsRouter.post("/", verifyToken, async (req: any, res) => {
  const { type, message, userId, postId, commentId, route } = req.body;

  if (!type || !message || !userId) {
    res.status(400).json({
      error: "Type, message, and userId are required",
    });
    return;
  }

  try {
    const targetProfile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!targetProfile) {
      res.status(404).json({ error: "Target profile not found" });
      return;
    }

    const notification = await prisma.notification.create({
      data: {
        type,
        message,
        profileId: userId,
        postId: postId || null,
        commentId: commentId || null,
        route: route || null,
  }});

    res.status(201).json(notification);
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ error: "Failed to create notification" });
  }
});

notificationsRouter.put("/:id/read", verifyToken, async (req: any, res) => {
  const { id } = req.params;
  const profileId = req.user?.profileId || req.user?.id;

  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { profileId: true },
    });

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    if (notification.profileId !== profileId) {
      res
        .status(403)
        .json({ error: "Cannot mark other profile's notifications as read" });
      return;
    }

    const updatedNotification = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    res.json(updatedNotification);
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ error: "Failed to update notification" });
  }
});

notificationsRouter.put("/mark-all-read", verifyToken, async (req: any, res) => {
  const profileId = req.user?.profileId || req.user?.id;

  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await prisma.notification.updateMany({
      where: {
        profileId: profileId,
        read: false,
      },
      data: { read: true },
    });

    res.json({
      message: "All notifications marked as read",
      count: result.count,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ error: "Failed to update notifications" });
  }
});

notificationsRouter.get("/unread-count", verifyToken, async (req: any, res) => {
  const profileId = req.user?.profileId || req.user?.id;

  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const count = await prisma.notification.count({
      where: {
        profileId: profileId,
        read: false,
      },
    });

    res.json({ unreadCount: count });
  } catch (error) {
    console.error("Error getting unread count:", error);
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

notificationsRouter.delete("/:id", verifyToken, async (req: any, res) => {
  const { id } = req.params;
  const profileId = req.user?.profileId || req.user?.id;

  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { profileId: true },
    });

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    if (notification.profileId !== profileId) {
      res
        .status(403)
        .json({ error: "Cannot delete other profile's notifications" });
      return;
    }

    await prisma.notification.delete({
      where: { id },
    });

    res.status(204).end();
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

export const createNotification = async (
  type: string,
  message: string,
  profileId: number,
  postId?: string,
  commentId?: string,
  route?: string
) => {
  try {
    return await prisma.notification.create({
      data: {
        type,
        message,
        profileId: profileId,
        postId: postId || null,
        commentId: commentId || null,
        route: route || null,
      },
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

export default notificationsRouter;