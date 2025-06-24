import { PrismaClient } from '@prisma/client';
import express, { Request, Response } from 'express';

const router = express.Router();
const prisma = new PrismaClient();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, otherUserId } = req.query;
    
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          {
            AND: [
              { senderId: parseInt(userId as string) },
              { receiverId: parseInt(otherUserId as string) }
            ]
          },
          {
            AND: [
              { senderId: parseInt(otherUserId as string) },
              { receiverId: parseInt(userId as string) }
            ]
          }
        ]
      },
      orderBy: {
        createdAt: 'asc'
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            email: true
          }
        },
        receiver: {
          select: {
            id: true,
            username: true,
            email: true
          }
        }
      }
    });
    
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;