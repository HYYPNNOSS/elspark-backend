// ./routes/userRoutes.ts
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { verifyToken } from "../middlewares/authMiddleware";
import multer from "multer";
import path from "path";
import { profilePictureUpload } from "../config/wasabi-config";

const router = express.Router();
const prisma = new PrismaClient();

// Get all profiles
router.get("/", async (req: Request, res: Response) => {
  try {
    const profiles = await prisma.profile.findMany({
      select: {
        id: true,
        username: true,
        bio: true,
        profilePicture: true,
        accountId: true,
        account: {
          select: {
            email: true,
            cyberCoins: true,
          },
        },
      },
    });
    res.json(profiles);
  } catch (error) {
    console.error("Error fetching profiles:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get current user/profile info (add this new endpoint)
router.get("/me", verifyToken, async (req: any, res: Response) => {
  try {
    const profileId = req.user.profileId || req.user.id;

    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      include: {
        account: {
          select: {
            id: true,
            email: true,
            cyberCoins: true,
          },
        },
      },
    });

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.status(200).json({
      user: {
        id: profile.id,
        accountId: profile.accountId,
        username: profile.username,
        email: profile.account.email,
        profilePicture: profile.profilePicture,
        bio: profile.bio,
        cyberCoins: Number(profile.account.cyberCoins),
        online: profile.online,
        isApproved: profile.isApproved,
      },
    });
  } catch (error) {
    console.error("Error fetching current user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get notifications
router.get("/notifications", verifyToken, async (req: any, res) => {
  try {
    const profileId = req.user.profileId || req.user.id;

    const notifications = await prisma.notification.findMany({
      where: { profileId: profileId },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Get public posts
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

// Get profile by ID
router.get("/id/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const profile = await prisma.profile.findUnique({
      where: { id: Number(id) },
      select: {
        id: true,
        username: true,
        profilePicture: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
        online: true,
        isonrand: true,
        looking: true,
        accountId: true,
        account: {
          select: {
            email: true,
            cyberCoins: true,
          },
        },
        posts: {
          select: {
            id: true,
            title: true,
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

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.json({
      user: {
        id: profile.id,
        accountId: profile.accountId,
        username: profile.username,
        email: profile.account.email,
        profilePicture: profile.profilePicture,
        bio: profile.bio,
        cyberCoins: Number(profile.account.cyberCoins),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        online: profile.online,
        isonrand: profile.isonrand,
        looking: profile.looking,
        posts: profile.posts,
      },
    });
  } catch (err) {
    console.error("Error fetching profile by ID:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get profile by username
router.get("/:username", async (req: Request, res: Response) => {
  const { username } = req.params;

  try {
    const profile = await prisma.profile.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        profilePicture: true,
        bio: true,
        createdAt: true,
        updatedAt: true,
        online: true,
        isonrand: true,
        looking: true,
        isApproved: true,
        accountId: true,
        account: {
          select: {
            email: true,
            cyberCoins: true,
          },
        },
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

    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({
      user: {
        id: profile.id,
        accountId: profile.accountId,
        username: profile.username,
        email: profile.account.email,
        profilePicture: profile.profilePicture,
        bio: profile.bio,
        cyberCoins: Number(profile.account.cyberCoins),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        online: profile.online,
        isonrand: profile.isonrand,
        looking: profile.looking,
        isApproved: profile.isApproved,
        posts: profile.posts,
      },
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Send cyber coins (now works across profiles in same account)
router.post("/send-coins", verifyToken, async (req: any, res) => {
  const { recipientId, amount } = req.body;
  const senderProfileId = req.user.profileId || req.user.id;

  // Validation
  if (!recipientId || !amount) {
    res.status(400).json({ error: "Recipient ID and amount are required" });
    return;
  }

  if (typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "Amount must be a positive number" });
    return;
  }

  if (senderProfileId === recipientId) {
    res.status(400).json({ error: "Cannot send coins to yourself" });
    return;
  }

  // Round to 2 decimal places
  const roundedAmount = Math.round(amount * 100) / 100;

  try {
    // Get sender profile and account
    const senderProfile = await prisma.profile.findUnique({
      where: { id: senderProfileId },
      include: { account: true },
    });

    if (!senderProfile) {
      res.status(404).json({ error: "Sender profile not found" });
      return;
    }

    // Get recipient profile and account
    const recipientProfile = await prisma.profile.findUnique({
      where: { id: recipientId },
      include: { account: true },
    });

    if (!recipientProfile) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    // Check if trying to send to another profile in same account
    if (senderProfile.accountId === recipientProfile.accountId) {
      res
        .status(400)
        .json({ error: "Cannot transfer coins between your own profiles" });
      return;
    }

    const senderCoins = Number(senderProfile.account.cyberCoins);

    if (senderCoins < roundedAmount) {
      res.status(400).json({ error: "Insufficient cyber coins" });
      return;
    }

    // Perform the transaction between accounts
    await prisma.$transaction([
      // Deduct from sender's account
      prisma.account.update({
        where: { id: senderProfile.accountId },
        data: { cyberCoins: { decrement: roundedAmount } },
      }),
      // Add to recipient's account
      prisma.account.update({
        where: { id: recipientProfile.accountId },
        data: { cyberCoins: { increment: roundedAmount } },
      }),
    ]);

    // Get updated balance
    const updatedSenderAccount = await prisma.account.findUnique({
      where: { id: senderProfile.accountId },
      select: { cyberCoins: true },
    });

    res.status(200).json({
      message: `Successfully sent ${roundedAmount} cyber coins to ${recipientProfile.username}`,
      senderBalance: updatedSenderAccount?.cyberCoins,
      amountSent: roundedAmount,
      recipient: recipientProfile.username,
    });
  } catch (error) {
    console.error("Failed to send cyber coins:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Update bio
router.put("/:id/bio", verifyToken, async (req: any, res: Response) => {
  const { id } = req.params;
  const { bio } = req.body;
  const profileId = req.user.profileId || req.user.id;

  // Check if user is updating their own bio
  if (parseInt(id) !== profileId) {
    res.status(403).json({ error: "You can only update your own bio" });
    return;
  }

  try {
    const updatedProfile = await prisma.profile.update({
      where: { id: parseInt(id) },
      data: { bio },
      include: {
        account: {
          select: {
            email: true,
            cyberCoins: true,
          },
        },
      },
    });

    res.status(200).json({
      message: "Bio updated successfully",
      user: {
        id: updatedProfile.id,
        accountId: updatedProfile.accountId,
        username: updatedProfile.username,
        email: updatedProfile.account.email,
        bio: updatedProfile.bio,
        profilePicture: updatedProfile.profilePicture,
        cyberCoins: Number(updatedProfile.account.cyberCoins),
      },
    });
  } catch (error) {
    console.error("Error updating bio:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update profile picture
router.put(
  "/:id/profile-picture",
  verifyToken,
  profilePictureUpload.single("profilePicture"),
  async (req: any, res: Response) => {
    const { id } = req.params;
    const profileId = req.user.profileId || req.user.id;

    // Check if user is updating their own profile picture
    if (parseInt(id) !== profileId) {
      res
        .status(403)
        .json({ error: "You can only update your own profile picture" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No image file provided" });
      return;
    }

    try {
      const profilePicturePath = (req.file as Express.MulterS3.File).location;

      const prefix = "https://elspark.s3.eu-west-1.wasabisys.com";
      let path = profilePicturePath;

      if (path.startsWith(prefix)) {
        path = path.substring(prefix.length);
      }

      console.log(path);

      const updatedProfile = await prisma.profile.update({
        where: { id: parseInt(id) },
        data: { profilePicture: path },
        include: {
          account: {
            select: {
              email: true,
              cyberCoins: true,
            },
          },
        },
      });

      res.status(200).json({
        message: "Profile picture updated successfully",
        user: {
          id: updatedProfile.id,
          accountId: updatedProfile.accountId,
          username: updatedProfile.username,
          email: updatedProfile.account.email,
          bio: updatedProfile.bio,
          profilePicture: updatedProfile.profilePicture,
          cyberCoins: Number(updatedProfile.account.cyberCoins),
        },
        profilePictureUrl: profilePicturePath,
      });
    } catch (error) {
      console.error("Error updating profile picture:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get profile's posts by username
router.get("/:username/posts", async (req: Request, res: Response) => {
  const { username } = req.params;

  try {
    const profile = await prisma.profile.findUnique({
      where: { username },
      select: {
        posts: {
          select: {
            id: true,
            title: true,
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

    if (!profile) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json(profile.posts);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get profile picture by ID
router.get("/profile-picture/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const profile = await prisma.profile.findUnique({
      where: { id: Number(id) },
      select: {
        id: true,
        profilePicture: true,
      },
    });

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.status(200).json({
      id: profile.id,
      profilePicture: profile.profilePicture,
    });
  } catch (err) {
    console.error("Error fetching profile picture:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update profile (bio and/or picture)
router.put(
  "/:id",
  verifyToken,
  profilePictureUpload.single("profilePicture"),
  async (req: any, res: Response) => {
    const { id } = req.params;
    const profileId = req.user.profileId || req.user.id;

    const bio = req.body.bio;
    const profilePictureFile = req.file;

    if (parseInt(id) !== profileId) {
      res.status(403).json({ error: "You can only update your own profile" });
      return;
    }

    const updateData: any = {};
    if (bio !== undefined) updateData.bio = bio;
    if (profilePictureFile) {
      updateData.profilePicture = (
        profilePictureFile as Express.MulterS3.File
      ).location;
    }

    try {
      const updatedProfile = await prisma.profile.update({
        where: { id: parseInt(id) },
        data: updateData,
        include: {
          account: {
            select: {
              email: true,
              cyberCoins: true,
            },
          },
        },
      });

      res.status(200).json({
        message: "Profile updated successfully",
        user: {
          id: updatedProfile.id,
          accountId: updatedProfile.accountId,
          username: updatedProfile.username,
          email: updatedProfile.account.email,
          bio: updatedProfile.bio,
          profilePicture: updatedProfile.profilePicture,
          cyberCoins: Number(updatedProfile.account.cyberCoins),
        },
      });
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;