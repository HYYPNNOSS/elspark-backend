import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';


const router = express.Router();
const prisma = new PrismaClient();

// GET /users - Get all users with statistics
router.get('/users', async (req: Request, res: Response) => {
    try {
      // Get all users (excluding sensitive data like passwords)
      const users = await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          isApproved: true,
          isMooshi: true,
          online: true,
          createdAt: true,
          updatedAt: true,
          mooshiNumber: true,
          profilePicture: true,
          bio: true,
          cyberCoins: true,
          color: true
        },
        orderBy: [
          { isMooshi: 'asc' }, // Non-Mooshis first
          { createdAt: 'desc' } // Then by creation date
        ]
      });
  
      // Calculate statistics
      const totalUsers = users.length;
      const mooshis = users.filter(user => user.isMooshi);
      const regularUsers = users.filter(user => !user.isMooshi);
      const approvedUsers = regularUsers.filter(user => user.isApproved).length;
      const pendingUsers = regularUsers.filter(user => !user.isApproved).length;
      const onlineUsers = users.filter(user => user.online).length;
  
      const stats = {
        totalUsers: regularUsers.length, // Only count regular users in total
        approvedUsers,
        pendingUsers,
        onlineUsers,
        totalMooshis: mooshis.length
      };
  
      res.status(200).json({
        success: true,
        users: users,
        stats: stats,
        timestamp: new Date().toISOString()
      });
  
    } catch (error) {
      console.error('Error fetching admin users:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to fetch users',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  // PUT /users/:id/approval - Update user approval status
  router.put('/users/:id/approval', async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      const { isApproved } = req.body;
  
      // Validate input
      if (isNaN(userId)) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid user ID' 
        });
        return;
      }
  
      if (typeof isApproved !== 'boolean') {
        res.status(400).json({ 
          success: false,
          error: 'isApproved must be a boolean value' 
        });
        return;
      }
  
      // Check if user exists and is not a Mooshi
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, isMooshi: true, isApproved: true }
      });
  
      if (!existingUser) {
        res.status(404).json({ 
          success: false,
          error: 'User not found' 
        });
        return;
      }
  
      if (existingUser.isMooshi) {
        res.status(400).json({ 
          success: false,
          error: 'Cannot modify approval status of Mooshi accounts' 
        });
        return;
      }
  
      // Update user approval status
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { isApproved },
        select: {
          id: true,
          username: true,
          email: true,
          isApproved: true,
          updatedAt: true
        }
      });
  
      res.status(200).json({
        success: true,
        message: `User ${updatedUser.username} ${isApproved ? 'approved' : 'approval revoked'}`,
        user: updatedUser,
        previousStatus: existingUser.isApproved,
        newStatus: isApproved
      });
  
    } catch (error) {
      console.error('Error updating user approval:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to update user approval status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  // Optional: GET /stats - Get just the statistics (lighter endpoint)
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const [totalUsers, approvedUsers, onlineUsers, totalMooshis] = await Promise.all([
        prisma.user.count({ where: { isMooshi: false } }),
        prisma.user.count({ where: { isMooshi: false, isApproved: true } }),
        prisma.user.count({ where: { online: true } }),
        prisma.user.count({ where: { isMooshi: true } })
      ]);
  
      const pendingUsers = totalUsers - approvedUsers;
  
      res.status(200).json({
        success: true,
        stats: {
          totalUsers,
          approvedUsers,
          pendingUsers,
          onlineUsers,
          totalMooshis
        },
        timestamp: new Date().toISOString()
      });
  
    } catch (error) {
      console.error('Error fetching admin stats:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to fetch statistics' 
      });
    }
  });

export default router;