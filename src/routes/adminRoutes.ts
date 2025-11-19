import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

router.get('/users', async (req: Request, res: Response) => {
  try {
    const profiles = await prisma.profile.findMany({
      select: {
        id: true,
        username: true,
        isApproved: true,
        isMooshi: true,
        online: true,
        createdAt: true,
        updatedAt: true,
        mooshiNumber: true,
        profilePicture: true,
        bio: true,
        color: true,
        accountId: true,
        account: {
          select: {
            email: true,
            cyberCoins: true
          }
        }
      },
      orderBy: [
        { isMooshi: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    const users = profiles.map(profile => ({
      id: profile.id,
      username: profile.username,
      email: profile.account.email,
      isApproved: profile.isApproved,
      isMooshi: profile.isMooshi,
      online: profile.online,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      mooshiNumber: profile.mooshiNumber,
      profilePicture: profile.profilePicture,
      bio: profile.bio,
      cyberCoins: Number(profile.account.cyberCoins),
      color: profile.color,
      accountId: profile.accountId
    }));

    const mooshis = users.filter(user => user.isMooshi);
    const regularUsers = users.filter(user => !user.isMooshi);
    const approvedUsers = regularUsers.filter(user => user.isApproved).length;
    const pendingUsers = regularUsers.filter(user => !user.isApproved).length;
    const onlineUsers = users.filter(user => user.online).length;

    const stats = {
      totalUsers: regularUsers.length,
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

router.put('/users/:id/approval', async (req: Request, res: Response) => {
  try {
    const profileId = parseInt(req.params.id);
    const { isApproved } = req.body;

    if (isNaN(profileId)) {
      res.status(400).json({ 
        success: false,
        error: 'Invalid profile ID' 
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

    const existingProfile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { 
        id: true, 
        username: true, 
        isMooshi: true, 
        isApproved: true,
        account: {
          select: {
            email: true
          }
        }
      }
    });

    if (!existingProfile) {
      res.status(404).json({ 
        success: false,
        error: 'Profile not found' 
      });
      return;
    }

    if (existingProfile.isMooshi) {
      res.status(400).json({ 
        success: false,
        error: 'Cannot modify approval status of Mooshi accounts' 
      });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: profileId },
      data: { isApproved },
      select: {
        id: true,
        username: true,
        isApproved: true,
        updatedAt: true,
        account: {
          select: {
            email: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      message: `Profile ${updatedProfile.username} ${isApproved ? 'approved' : 'approval revoked'}`,
      user: {
        id: updatedProfile.id,
        username: updatedProfile.username,
        email: updatedProfile.account.email,
        isApproved: updatedProfile.isApproved,
        updatedAt: updatedProfile.updatedAt
      },
      previousStatus: existingProfile.isApproved,
      newStatus: isApproved
    });

  } catch (error) {
    console.error('Error updating profile approval:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update profile approval status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const [totalUsers, approvedUsers, onlineUsers, totalMooshis] = await Promise.all([
      prisma.profile.count({ where: { isMooshi: false } }),
      prisma.profile.count({ where: { isMooshi: false, isApproved: true } }),
      prisma.profile.count({ where: { online: true } }),
      prisma.profile.count({ where: { isMooshi: true } })
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

router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const accounts = await prisma.account.findMany({
      select: {
        id: true,
        email: true,
        cyberCoins: true,
        createdAt: true,
        updatedAt: true,
        profiles: {
          select: {
            id: true,
            username: true,
            isApproved: true,
            isMooshi: true,
            online: true,
            profilePicture: true,
            isActive: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    const totalAccounts = accounts.length;
    const accountsWithMultipleProfiles = accounts.filter(acc => acc.profiles.length > 1).length;
    const totalProfiles = accounts.reduce((sum, acc) => sum + acc.profiles.length, 0);

    res.status(200).json({
      success: true,
      accounts: accounts.map(acc => ({
        ...acc,
        cyberCoins: Number(acc.cyberCoins),
        profileCount: acc.profiles.length
      })),
      stats: {
        totalAccounts,
        accountsWithMultipleProfiles,
        totalProfiles,
        averageProfilesPerAccount: (totalProfiles / totalAccounts).toFixed(2)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch accounts',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;