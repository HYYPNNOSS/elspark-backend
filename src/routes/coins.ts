import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../middlewares/authMiddleware'; 

const router = express.Router();
const prisma = new PrismaClient();

// Extend Request to include userId
interface AuthenticatedRequest extends Request {
  userId?: number;
}


const mockAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const userId = parseInt(req.headers['user-id'] as string);
  if (!userId) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  req.userId = userId;
  next();
};

router.post('/buy', mockAuth, async (req: AuthenticatedRequest, res: Response) => {
  console.log("amount");
  
  const { amount } = req.body;
  const validAmounts = [5, 10, 15, 20];
  console.log(amount);

  if (!validAmounts.includes(amount)) {
    res.status(400).json({ message: 'Invalid amount' });
    console.log("amount");
    return;
  }

  try {
    const updatedUser = await prisma.account.update({
        where: { id: req.userId! },
        data: { cyberCoins: { increment: amount } },
        select: {
          id: true,
          // username: true,
          cyberCoins: true
        }
      });
      

    res.json({
      message: `Added ${amount} coins`,
      cyberCoins: updatedUser.cyberCoins
    });
  } catch (error) {
    console.error('Error adding coins:', error);
    res.status(500).json({ error: 'Failed to add coins' });
  }
});

export default router;
