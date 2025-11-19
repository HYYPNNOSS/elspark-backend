import express from "express";
import { PrismaClient } from "@prisma/client";
import { verifyToken } from "../middlewares/authMiddleware";
import { createNotification } from "./notificationsRoutes";

const router = express.Router();
const prisma = new PrismaClient();

router.post("/coown/:postId", verifyToken, async (req: any, res) => {
  const profileId = req.user.profileId || req.user.id;
  const postId = Number(req.params.postId);
  const coinAmount = 1;

  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { 
        author: {
          include: {
            account: true
          }
        } 
      },
    });

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    if (post.authorId === profileId) {
      res.status(400).json({ error: "Cannot co-own your own post" });
      return;
    }

    const existingCoowner = await prisma.postCoowner.findUnique({
      where: {
        postId_userId: {
          postId: postId,
          userId: profileId,
        },
      },
    });

    if (existingCoowner) {
      res.status(400).json({ error: "Already a co-owner of this post" });
      return;
    }

    const currentProfile = await prisma.profile.findUnique({
      where: { id: profileId },
      include: { account: true },
    });

    if (!currentProfile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const currentUserCoins = Number(currentProfile.account.cyberCoins);

    if (currentUserCoins < coinAmount) {
      res.status(400).json({
        error: "Insufficient cyber coins. You need 1 cyber coin to co-own this post.",
      });
      return;
    }

    if (currentProfile.accountId === post.author.accountId) {
      res.status(400).json({ 
        error: "Cannot co-own posts from your other profiles" 
      });
      return;
    }

    await prisma.$transaction([
      prisma.account.update({
        where: { id: currentProfile.accountId },
        data: { cyberCoins: { decrement: coinAmount } },
      }),
      prisma.account.update({
        where: { id: post.author.accountId },
        data: { cyberCoins: { increment: coinAmount } },
      }),
      prisma.postCoowner.create({
        data: { postId, userId: profileId },
      }),
    ]);

    const updatedAccount = await prisma.account.findUnique({
      where: { id: currentProfile.accountId },
      select: { cyberCoins: true },
    });

    await createNotification(
      'coowner',
      `${currentProfile.username} purchased a copy of your digi-post`,
      post.authorId,
      undefined,
      undefined,
      `/profile/${currentProfile.username}` 
    );

    res.json({
      message: `You now co-own this post! 1 cyber coin sent to ${post.author.username}`,
      yourBalance: updatedAccount?.cyberCoins,
      coinsSent: coinAmount,
      postOwner: post.author.username,
    });
  } catch (error: any) {
    console.error("Failed to co-own post:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/coowned/:targetId", verifyToken, async (req: any, res) => {
  const targetId = Number(req.params.targetId);

  try {
    const coowned = await prisma.postCoowner.findMany({
      where: { userId: targetId },
      include: {
        post: {
          select: {
            id: true,
            text: true,
            title: true,
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
        },
      },
    });

    res.json(coowned.map((item) => item.post));
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;