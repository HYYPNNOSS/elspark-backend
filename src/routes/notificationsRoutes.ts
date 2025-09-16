import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const notificationsRouter = Router();

// Interface for authenticated request
interface AuthRequest extends Request {
  user?: { id: number; username: string };
}

// Middleware to verify token (you should already have this)
const verifyToken = (req: any, res: any, next: any) => {
  // Your existing token verification middleware
  // This should set req.user with id and username
  next();
};

// GET /api/notifications - Get all notifications for current user
notificationsRouter.get("/all", verifyToken, async (req: any, res) => {
  const userId = req.user?.id;

//   if (!userId) {
//     res.status(401).json({ error: "Unauthorized" });
//     return;
//   }

  try {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50, // Limit to last 50 notifications
    });

    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// POST /api/notifications - Create a new notification
notificationsRouter.post("/", verifyToken, async (req: any, res) => {
  const { type, message, userId, postId, commentId } = req.body;

  // Validate required fields
  if (!type || !message || !userId) {
    res.status(400).json({ 
      error: "Type, message, and userId are required" 
    });
    return;
  }

  try {
    // Check if target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!targetUser) {
      res.status(404).json({ error: "Target user not found" });
      return;
    }

    // Create notification
    const notification = await prisma.notification.create({
      data: {
        type,
        message,
        userId,
        postId: postId || null,
        commentId: commentId || null,
      },
    });

    res.status(201).json(notification);
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ error: "Failed to create notification" });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
notificationsRouter.put("/:id/read", verifyToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // Check if notification belongs to current user
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { userId: true }
    });

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    if (notification.userId !== userId) {
      res.status(403).json({ error: "Cannot mark other user's notifications as read" });
      return;
    }

    // Mark as read
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

// PUT /api/notifications/mark-all-read - Mark all notifications as read for current user
notificationsRouter.put("/mark-all-read", verifyToken, async (req: any, res) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await prisma.notification.updateMany({
      where: { 
        userId,
        read: false 
      },
      data: { read: true },
    });

    res.json({ 
      message: "All notifications marked as read", 
      count: result.count 
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ error: "Failed to update notifications" });
  }
});

// GET /api/notifications/unread-count - Get count of unread notifications
notificationsRouter.get("/unread-count", verifyToken, async (req: any, res) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const count = await prisma.notification.count({
      where: { 
        userId,
        read: false 
      },
    });

    res.json({ unreadCount: count });
  } catch (error) {
    console.error("Error getting unread count:", error);
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

// DELETE /api/notifications/:id - Delete a specific notification
notificationsRouter.delete("/:id", verifyToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // Check if notification belongs to current user
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { userId: true }
    });

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    if (notification.userId !== userId) {
      res.status(403).json({ error: "Cannot delete other user's notifications" });
      return;
    }

    // Delete notification
    await prisma.notification.delete({
      where: { id },
    });

    res.status(204).end();
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

// Helper function to create notifications (export this to use in other routes)
export const createNotification = async (
  type: string,
  message: string,
  userId: number,
  postId?: string,
  commentId?: string
) => {
  try {
    return await prisma.notification.create({
      data: {
        type,
        message,
        userId,
        postId: postId || null,
        commentId: commentId || null,
      },
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

export default notificationsRouter;