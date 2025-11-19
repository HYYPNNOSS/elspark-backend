import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyToken } from "../middlewares/authMiddleware";
import { createNotification } from './notificationsRoutes'; 

const followRouter = express.Router();
const prisma = new PrismaClient();

followRouter.post("/follow", verifyToken, async (req: any, res) => {
    const { userId } = req.body;
    const followerId = req.user.id;
  
    if (!userId) {
      res.status(400).json({ error: "User ID is required" });
      return;
    }
  
    if (followerId === userId) {
      res.status(400).json({ error: "Cannot follow yourself" });
      return;
    }
  
    try {
      const userToFollow = await prisma.profile.findUnique({
        where: { id: userId },
        select: { id: true, username: true },
      });
  
      if (!userToFollow) {
        res.status(404).json({ error: "User not found" });
        return;
      }
  
      const existingFollow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: followerId,
            followingId: userId,
          },
        },
      });
  
      if (existingFollow) {
        res.status(400).json({ error: "Already following this user" });
        return;
      }

      
  
      await prisma.follow.create({
        data: {
          followerId: followerId,
          followingId: userId,
        },
      });
  
      await prisma.notification.create({
        data: {
          type: "follow",
          message: `${req.user.username} started following you`,
          profileId: userId,
        },
      });

      await createNotification(
        'follow',
        `${req.user.username} started following you`,
        followerId, 
        undefined, 
        undefined,  
        `/profile/$${req.user.username}`
      );

      res.status(200).json({
        message: `Successfully followed ${userToFollow.username}`,
        followedUser: userToFollow.username,
      });

      
    } catch (error) {
      console.error("Failed to follow user:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  followRouter.post("/unfollow", verifyToken, async (req: any, res) => {
    const { userId } = req.body;
    const followerId = req.user.id;
  
    if (!userId) {
      res.status(400).json({ error: "User ID is required" });
      return;
    }
  
    if (followerId === userId) {
      res.status(400).json({ error: "Cannot unfollow yourself" });
      return;
    }
  
    try {
      const userToUnfollow = await prisma.profile.findUnique({
        where: { id: userId },
        select: { id: true, username: true },
      });
  
      if (!userToUnfollow) {
        res.status(404).json({ error: "User not found" });
        return;
      }
  
      const existingFollow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: followerId,
            followingId: userId,
          },
        },
      });
  
      if (!existingFollow) {
        res.status(400).json({ error: "You are not following this user" });
        return;
      }
  
      await prisma.follow.delete({
        where: {
          followerId_followingId: {
            followerId: followerId,
            followingId: userId,
          },
        },
      });
  
      res.status(200).json({
        message: `Successfully unfollowed ${userToUnfollow.username}`,
        unfollowedUser: userToUnfollow.username,
      });
    } catch (error) {
      console.error("Failed to unfollow user:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  followRouter.get("/following-feed", verifyToken, async (req: any, res) => {
    console.log("heyyy following-feed")
  
    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
  
    try {
      const posts = await prisma.post.findMany({
        where: {
          author: {
            followers: {
              some: {
                followerId: userId,
              },
            },
          },
          isPrivate: false,
        },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
            },
          },
          coowners: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  profilePicture: true,
                },
              },
            },
          },
          comments: {
            include: {
              author: {
                select: {
                  id: true,
                  username: true,
                  profilePicture: true,
                },
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 3,
          },
          _count: {
            select: {
              comments: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      });
  
      const totalPosts = await prisma.post.count({
        where: {
          author: {
            followers: {
              some: {
                followerId: userId,
              },
            },
          },
          isPrivate: false,
        },
      });
  
      const totalPages = Math.ceil(totalPosts / limit);
  
      res.status(200).json({
        posts,
        pagination: {
          currentPage: page,
          totalPages,
          totalPosts,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Failed to fetch following feed:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  followRouter.get("/following-collections", verifyToken, async (req: any, res) => {
    console.log("heyyy following-collections")
    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
  
    try {
      const collections = await prisma.postCollection.findMany({
        where: {
          user: {
            followers: {
              some: {
                followerId: userId,
              },
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
            },
          },
          posts: {
            include: {
              post: {
                include: {
                  author: {
                    select: {
                      id: true,
                      username: true,
                      profilePicture: true,
                    },
                  },
                  _count: {
                    select: {
                      comments: true,
                    },
                  },
                },
              },
            },
            take: 5,
          },
          _count: {
            select: {
              posts: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      });
  
      const totalCollections = await prisma.postCollection.count({
        where: {
          user: {
            followers: {
              some: {
                followerId: userId,
              },
            },
          },
        },
      });
  
      const totalPages = Math.ceil(totalCollections / limit);
  
      res.status(200).json({
        collections,
        pagination: {
          currentPage: page,
          totalPages,
          totalCollections,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Failed to fetch following collections:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  followRouter.get("/followers", verifyToken, async (req: any, res) => {
    const userId = req.user.id;
  
    try {
      const followers = await prisma.follow.findMany({
        where: {
          followingId: userId,
        },
        include: {
          follower: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
              bio: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });
  
      res.status(200).json({
        followers: followers.map((f) => ({
          ...f.follower,
          followedAt: f.createdAt,
        })),
        count: followers.length,
      });
    } catch (error) {
      console.error("Failed to fetch followers:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  followRouter.get("/following", verifyToken, async (req: any, res) => {
    const userId = req.user.id;
  
    try {
      const following = await prisma.follow.findMany({
        where: {
          followerId: userId,
        },
        include: {
          following: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
              bio: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });
  
      res.status(200).json({
        following: following.map((f) => ({
          ...f.following,
          followedAt: f.createdAt,
        })),
        count: following.length,
      });
    } catch (error) {
      console.error("Failed to fetch following:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  followRouter.get("/my-following", verifyToken, async (req: any, res) => {
    const userId = req.user.id;
    try {
      const following = await prisma.follow.findMany({
        where: {
          followerId: userId,
        },
        include: {
          following: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      res.status(200).json({
        following: following.map((f) => f.following),
        count: following.length,
      });
    } catch (error) {
      console.error("Failed to fetch my following:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  followRouter.get("/is-following/:userId", verifyToken, async (req: any, res) => {
    const userId = parseInt(req.params.userId);
    const followerId = req.user.id;
  
    try {
      const isFollowing = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: followerId,
            followingId: userId,
          },
        },
      });
  
      res.status(200).json({
        isFollowing: !!isFollowing,
      });
    } catch (error) {
      console.error("Failed to check follow status:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

export default followRouter;