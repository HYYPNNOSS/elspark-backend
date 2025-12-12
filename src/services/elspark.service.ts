import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const prisma = new PrismaClient();

// Wasabi S3 Configuration
const s3Client = new S3Client({
  endpoint: process.env.WASABI_ENDPOINT || "https://s3.wasabisys.com",
  region: process.env.WASABI_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID!,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY!,
  },
});

const WASABI_BUCKET = process.env.WASABI_BUCKET_NAME || "elspark-videos";

export class ElsparkService {
  
  /**
   * Upload video directly to Live TV queue (costs 1 cyberCoin)
   */
  async uploadToLiveTV(
    profileId: number,
    videoFile: Express.Multer.File,
    title: string,
    description?: string
  ) {
    return await prisma.$transaction(async (tx) => {
      // 1. Get profile with account
      const profile = await tx.profile.findUnique({
        where: { id: profileId },
        include: { account: true }
      });

      if (!profile) {
        throw new Error('Profile not found');
      }

      // 2. Check cyberCoin balance
      const balance = profile.account.cyberCoins.toNumber();
      if (balance < 1) {
        throw new Error('Insufficient cyberCoins. You need 1 cyberCoin to upload.');
      }

      // 3. Deduct 1 cyberCoin
      await tx.account.update({
        where: { id: profile.accountId },
        data: {
          cyberCoins: {
            decrement: 1
          }
        }
      });

      // 4. Get video duration
      const duration = await this.getVideoDuration(videoFile.path);

      // 5. Upload to Wasabi
      const wasabiKey = `live-tv/${Date.now()}-${videoFile.originalname}`;
      const wasabiUrl = await this.uploadToWasabi(videoFile, wasabiKey);

      // 6. Delete local temp file
      if (fs.existsSync(videoFile.path)) {
        fs.unlinkSync(videoFile.path);
      }

      // 7. Create video record
      const video = await tx.elsparkVideo.create({
        data: {
          title,
          description,
          url: wasabiUrl,
          filename: videoFile.originalname,
          duration,
          fileSize: videoFile.size,
          uploaderId: profileId,
          source: 'live_tv',
          status: 'queued'
        }
      });

      // 8. Get next position in queue
      const lastQueueItem = await tx.liveTVQueue.findFirst({
        orderBy: { position: 'desc' }
      });
      const nextPosition = lastQueueItem ? lastQueueItem.position + 1 : 1;

      // 9. Add to queue
      const queueItem = await tx.liveTVQueue.create({
        data: {
          videoId: video.id,
          position: nextPosition,
          status: 'waiting',
          uploaderId: profileId
        }
      });

      return {
        video,
        queueItem,
        newBalance: balance - 1
      };
    });
  }

  /**
   * Upload video to user's collection (costs 1 cyberCoin)
   */
  async uploadToCollection(
    profileId: number,
    videoFile: Express.Multer.File,
    title: string,
    description?: string
  ) {
    return await prisma.$transaction(async (tx) => {
      // 1. Get profile with account
      const profile = await tx.profile.findUnique({
        where: { id: profileId },
        include: { account: true }
      });

      if (!profile) {
        throw new Error('Profile not found');
      }

      // 2. Check cyberCoin balance
      const balance = profile.account.cyberCoins.toNumber();
      if (balance < 1) {
        throw new Error('Insufficient cyberCoins. You need 1 cyberCoin to upload.');
      }

      // 3. Deduct 1 cyberCoin
      await tx.account.update({
        where: { id: profile.accountId },
        data: {
          cyberCoins: {
            decrement: 1
          }
        }
      });

      // 4. Get video duration
      const duration = await this.getVideoDuration(videoFile.path);

      // 5. Upload to Wasabi
      const wasabiKey = `collections/${profileId}/${Date.now()}-${videoFile.originalname}`;
      const wasabiUrl = await this.uploadToWasabi(videoFile, wasabiKey);

      // 6. Delete local temp file
      if (fs.existsSync(videoFile.path)) {
        fs.unlinkSync(videoFile.path);
      }

      // 7. Create video record
      const video = await tx.elsparkVideo.create({
        data: {
          title,
          description,
          url: wasabiUrl,
          filename: videoFile.originalname,
          duration,
          fileSize: videoFile.size,
          uploaderId: profileId,
          source: 'collection',
          status: 'in_collection'
        }
      });

      // 8. Add to user's collection
      await tx.elsparkCollection.create({
        data: {
          profileId,
          videoId: video.id,
          purchaseType: 'upload'
        }
      });

      return {
        video,
        newBalance: balance - 1
      };
    });
  }

  /**
   * Purchase video for collection (costs 2 cyberCoins, uploader gets 1)
   */
  async purchaseVideo(profileId: number, videoId: string) {
    return await prisma.$transaction(async (tx) => {
      // 1. Get buyer profile with account
      const buyer = await tx.profile.findUnique({
        where: { id: profileId },
        include: { account: true }
      });

      if (!buyer) {
        throw new Error('Profile not found');
      }

      // 2. Get video with uploader
      const video = await tx.elsparkVideo.findUnique({
        where: { id: videoId },
        include: {
          uploader: {
            include: { account: true }
          }
        }
      });

      if (!video) {
        throw new Error('Video not found');
      }

      // 3. Check if already in collection
      const existing = await tx.elsparkCollection.findUnique({
        where: {
          profileId_videoId: {
            profileId,
            videoId
          }
        }
      });

      if (existing) {
        throw new Error('Video already in your collection');
      }

      // 4. Check buyer balance
      const buyerBalance = buyer.account.cyberCoins.toNumber();
      if (buyerBalance < 2) {
        throw new Error('Insufficient cyberCoins. You need 2 cyberCoins to purchase.');
      }

      // 5. Deduct 2 cyberCoins from buyer
      await tx.account.update({
        where: { id: buyer.accountId },
        data: {
          cyberCoins: {
            decrement: 2
          }
        }
      });

      // 6. Award 1 cyberCoin to uploader
      await tx.account.update({
        where: { id: video.uploader.accountId },
        data: {
          cyberCoins: {
            increment: 1
          }
        }
      });

      // 7. Add to buyer's collection
      const collectionItem = await tx.elsparkCollection.create({
        data: {
          profileId,
          videoId,
          purchaseType: 'purchase',
          purchasePrice: 2
        }
      });

      return {
        collectionItem,
        buyerNewBalance: buyerBalance - 2,
        uploaderNewBalance: video.uploader.account.cyberCoins.toNumber() + 1,
        uploaderId: video.uploaderId
      };
    });
  }

  /**
   * Post video from collection to Live TV (FREE - no cost)
   */
  async postToLiveTV(profileId: number, videoId: string) {
    return await prisma.$transaction(async (tx) => {
      // 1. Check if video is in user's collection
      const collectionItem = await tx.elsparkCollection.findUnique({
        where: {
          profileId_videoId: {
            profileId,
            videoId
          }
        },
        include: { video: true }
      });

      if (!collectionItem) {
        throw new Error('Video not found in your collection');
      }

      // 2. Check if already in queue
      const existingQueue = await tx.liveTVQueue.findFirst({
        where: {
          videoId,
          status: { in: ['waiting', 'playing'] }
        }
      });

      if (existingQueue) {
        throw new Error('Video is already in the queue');
      }

      // 3. Get next position
      const lastQueueItem = await tx.liveTVQueue.findFirst({
        orderBy: { position: 'desc' }
      });
      const nextPosition = lastQueueItem ? lastQueueItem.position + 1 : 1;

      // 4. Add to queue
      const queueItem = await tx.liveTVQueue.create({
        data: {
          videoId,
          position: nextPosition,
          status: 'waiting',
          uploaderId: profileId
        }
      });

      // 5. Update video status
      await tx.elsparkVideo.update({
        where: { id: videoId },
        data: { status: 'queued' }
      });

      return { queueItem, video: collectionItem.video };
    });
  }

  /**
   * Get user's collection
   */
  async getUserCollection(profileId: number) {
    const collection = await prisma.elsparkCollection.findMany({
      where: { profileId },
      include: {
        video: {
          include: {
            uploader: {
              select: {
                id: true,
                username: true,
                profilePicture: true
              }
            }
          }
        }
      },
      orderBy: { purchasedAt: 'desc' }
    });

    return collection;
  }

  /**
   * Remove video from collection
   */
  async removeFromCollection(profileId: number, videoId: string) {
    const deleted = await prisma.elsparkCollection.delete({
      where: {
        profileId_videoId: {
          profileId,
          videoId
        }
      }
    });

    return deleted;
  }

  /**
   * Get Live TV queue
   */
  async getQueue() {
    const queue = await prisma.liveTVQueue.findMany({
      where: {
        status: { in: ['waiting', 'playing'] }
      },
      include: {
        video: {
          include: {
            uploader: {
              select: {
                id: true,
                username: true,
                profilePicture: true
              }
            }
          }
        }
      },
      orderBy: { position: 'asc' }
    });

    return queue;
  }

  /**
   * Get currently playing video
   */
  async getCurrentVideo() {
    const current = await prisma.liveTVQueue.findFirst({
      where: { status: 'playing' },
      include: {
        video: {
          include: {
            uploader: {
              select: {
                id: true,
                username: true,
                profilePicture: true
              }
            }
          }
        }
      }
    });

    return current;
  }

  /**
   * Get video history
   */
  async getHistory(limit: number = 20) {
    const history = await prisma.liveTVQueue.findMany({
      where: { status: 'played' },
      include: {
        video: {
          include: {
            uploader: {
              select: {
                id: true,
                username: true,
                profilePicture: true
              }
            }
          }
        }
      },
      orderBy: { endTime: 'desc' },
      take: limit
    });

    return history;
  }

  /**
   * Get video details
   */
  async getVideoDetails(videoId: string) {
    const video = await prisma.elsparkVideo.findUnique({
      where: { id: videoId },
      include: {
        uploader: {
          select: {
            id: true,
            username: true,
            profilePicture: true
          }
        }
      }
    });

    return video;
  }

  /**
   * Delete video (only if user is owner)
   */
  async deleteVideo(profileId: number, videoId: string) {
    return await prisma.$transaction(async (tx) => {
      const video = await tx.elsparkVideo.findUnique({
        where: { id: videoId }
      });

      if (!video) {
        throw new Error('Video not found');
      }

      if (video.uploaderId !== profileId) {
        throw new Error('You can only delete your own videos');
      }

      // Remove from queue if exists
      await tx.liveTVQueue.deleteMany({
        where: { videoId }
      });

      // Remove from collections
      await tx.elsparkCollection.deleteMany({
        where: { videoId }
      });

      // Delete from Wasabi
      await this.deleteFromWasabi(video.url);

      // Delete video record
      await tx.elsparkVideo.delete({
        where: { id: videoId }
      });

      return { success: true };
    });
  }

  /**
   * Get cyberCoin balance
   */
  async getCoinBalance(profileId: number) {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      include: { account: true }
    });

    if (!profile) {
      throw new Error('Profile not found');
    }

    return profile.account.cyberCoins.toNumber();
  }

  /**
   * Get uploaded videos by user
   */
  async getUserUploadedVideos(profileId: number) {
    const videos = await prisma.elsparkVideo.findMany({
      where: { uploaderId: profileId },
      include: {
        uploader: {
          select: {
            id: true,
            username: true,
            profilePicture: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return videos;
  }

  /**
   * Get video duration using ffprobe
   */
  private async getVideoDuration(filePath: string): Promise<number> {
    try {
      const ffprobe = require('ffprobe');
      const ffprobeStatic = require('ffprobe-static');
      
      const info = await ffprobe(filePath, { path: ffprobeStatic.path });
      const duration = info.streams[0].duration;
      return duration ? parseFloat(duration) : 0;
    } catch (error) {
      console.error('Error getting video duration:', error);
      return 0;
    }
  }

  /**
   * Upload file to Wasabi S3
   */
  private async uploadToWasabi(file: Express.Multer.File, key: string): Promise<string> {
    try {
      const fileContent = fs.readFileSync(file.path);

      const command = new PutObjectCommand({
        Bucket: WASABI_BUCKET,
        Key: key,
        Body: fileContent,
        ContentType: file.mimetype,
        ACL: 'public-read', // Make videos publicly accessible
      });

      await s3Client.send(command);

      // Return the public URL
      const wasabiUrl = `https://${WASABI_BUCKET}.s3.wasabisys.com/${key}`;
      return wasabiUrl;
    } catch (error) {
      console.error('Error uploading to Wasabi:', error);
      throw new Error('Failed to upload video to storage');
    }
  }

  /**
   * Delete file from Wasabi S3
   */

  /**
   * Get transaction history for a user
   */
  async getTransactionHistory(profileId: number) {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      include: { account: true }
    });

    if (!profile) {
      throw new Error('Profile not found');
    }

    // Get all coin transactions from the account
    const transactions = await prisma.coinTransaction.findMany({
      where: { accountId: profile.accountId },
      orderBy: { createdAt: 'desc' }
    });

    // Get ElSpark-specific activities (uploads, purchases, sales)
    const uploads = await prisma.elsparkVideo.findMany({
      where: { uploaderId: profileId },
      select: {
        id: true,
        title: true,
        source: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const purchases = await prisma.elsparkCollection.findMany({
      where: { 
        profileId,
        purchaseType: 'purchase'
      },
      include: {
        video: {
          select: {
            id: true,
            title: true
          }
        }
      },
      orderBy: { purchasedAt: 'desc' }
    });

    // Get videos sold (where others purchased user's uploads)
    const sales = await prisma.elsparkCollection.findMany({
      where: {
        purchaseType: 'purchase',
        video: {
          uploaderId: profileId
        }
      },
      include: {
        video: {
          select: {
            id: true,
            title: true
          }
        },
        profile: {
          select: {
            id: true,
            username: true
          }
        }
      },
      orderBy: { purchasedAt: 'desc' }
    });

    // Combine and format activities
    const activities = [
      ...uploads.map(upload => ({
        type: upload.source === 'live_tv' ? 'upload_live_tv' : 'upload_collection',
        amount: -1,
        description: `Uploaded "${upload.title}"`,
        videoId: upload.id,
        videoTitle: upload.title,
        timestamp: upload.createdAt
      })),
      ...purchases.map(purchase => ({
        type: 'purchase',
        amount: -2,
        description: `Purchased "${purchase.video.title}"`,
        videoId: purchase.video.id,
        videoTitle: purchase.video.title,
        timestamp: purchase.purchasedAt
      })),
      ...sales.map(sale => ({
        type: 'sale',
        amount: 1,
        description: `Sold "${sale.video.title}" to @${sale.profile.username}`,
        videoId: sale.video.id,
        videoTitle: sale.video.title,
        buyerId: sale.profile.id,
        buyerUsername: sale.profile.username,
        timestamp: sale.purchasedAt
      }))
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return {
      currentBalance: profile.account.cyberCoins.toNumber(),
      stripeTransactions: transactions,
      elsparkActivities: activities
    };
  }
  
  private async deleteFromWasabi(url: string): Promise<void> {
    try {
      // Extract key from URL
      const urlParts = url.split('.s3.wasabisys.com/');
      if (urlParts.length !== 2) {
        console.error('Invalid Wasabi URL format:', url);
        return;
      }

      const key = urlParts[1];

      const command = new DeleteObjectCommand({
        Bucket: WASABI_BUCKET,
        Key: key,
      });

      await s3Client.send(command);
      console.log('Successfully deleted from Wasabi:', key);
    } catch (error) {
      console.error('Error deleting from Wasabi:', error);
      // Don't throw error, just log it
    }
  }
}