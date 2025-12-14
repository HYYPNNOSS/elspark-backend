import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const prisma = new PrismaClient();

// Wasabi S3 Configuration
const s3Client = new S3Client({
  endpoint: process.env.WASABI_ENDPOINT || "https://s3.eu-west-1.wasabisys.com",
  region: process.env.WASABI_REGION || "eu-west-1",
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID!,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY!,
  },
});

const WASABI_BUCKET = process.env.WASABI_BUCKET_NAME || "elspark";
const WASABI_REGION = process.env.WASABI_REGION || "eu-west-1";

export class ElsparkService {
  
  /**
   * Upload video to user's collection (costs 1 cyberCoin)
   * User becomes the initial owner with 100% ownership
   */
  async uploadToCollection(
    profileId: number,
    videoFile: Express.Multer.File,
    title: string,
    description?: string
  ) {
    // Get video duration BEFORE transaction
    const duration = await this.getVideoDuration(videoFile.path);

    // Upload to Wasabi BEFORE transaction
    const wasabiKey = `collections/${profileId}/${Date.now()}-${videoFile.originalname}`;
    const wasabiUrl = await this.uploadToWasabi(videoFile, wasabiKey);

    // Delete local temp file
    if (fs.existsSync(videoFile.path)) {
      fs.unlinkSync(videoFile.path);
    }

    // Now run transaction with all heavy work done
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

      // 4. Create video record
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

      // 5. Add to user's collection with 100% ownership
      await tx.videoOwnership.create({
        data: {
          videoId: video.id,
          profileId,
          ownershipShare: 100.0,
          acquisitionType: 'upload',
          acquisitionPrice: 1
        }
      });

      return {
        video,
        newBalance: balance - 1
      };
    }, {
      timeout: 100000 
    });
  }

  /**
   * Purchase video for collection (costs 2 cyberCoins)
   * Distributes revenue among all existing owners based on ownership share
   * Buyer receives ownership share based on total owners
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

      // 3. Check if already owns this video
      const existing = await tx.videoOwnership.findUnique({
        where: {
          profileId_videoId: {
            profileId,
            videoId
          }
        }
      });

      if (existing) {
        throw new Error('You already own this video');
      }

      // 4. Check buyer balance
      const buyerBalance = buyer.account.cyberCoins.toNumber();
      if (buyerBalance < 2) {
        throw new Error('Insufficient cyberCoins. You need 2 cyberCoins to purchase.');
      }

      // 5. Get all current owners
      const currentOwners = await tx.videoOwnership.findMany({
        where: { videoId },
        include: {
          profile: {
            include: { account: true }
          }
        }
      });

      if (currentOwners.length === 0) {
        throw new Error('Video has no owners');
      }

      // 6. Deduct 2 cyberCoins from buyer
      await tx.account.update({
        where: { id: buyer.accountId },
        data: {
          cyberCoins: {
            decrement: 2
          }
        }
      });

      // 7. Distribute 2 coins among existing owners based on ownership share
      const ownerUpdates: { profileId: number; amount: number; newBalance: number }[] = [];
      
      for (const owner of currentOwners) {
        const sharePercentage = owner.ownershipShare / 100;
        const revenueShare = 2 * sharePercentage;
        
        await tx.account.update({
          where: { id: owner.profile.accountId },
          data: {
            cyberCoins: {
              increment: revenueShare
            }
          }
        });

        ownerUpdates.push({
          profileId: owner.profileId,
          amount: revenueShare,
          newBalance: owner.profile.account.cyberCoins.toNumber() + revenueShare
        });
      }

      // 8. Calculate new ownership shares
      // New share = 100 / (total_owners + 1)
      const totalOwners = currentOwners.length;
      const newOwnerShare = 100 / (totalOwners + 1);
      const adjustedShare = 100 / (totalOwners + 1);

      // 9. Adjust existing owners' shares proportionally
      for (const owner of currentOwners) {
        const currentShare = owner.ownershipShare;
        const newShare = currentShare * (100 - newOwnerShare) / 100;
        
        await tx.videoOwnership.update({
          where: {
            profileId_videoId: {
              profileId: owner.profileId,
              videoId
            }
          },
          data: {
            ownershipShare: newShare
          }
        });
      }

      // 10. Add buyer as new owner
      const newOwnership = await tx.videoOwnership.create({
        data: {
          videoId,
          profileId,
          ownershipShare: newOwnerShare,
          acquisitionType: 'purchase',
          acquisitionPrice: 2
        }
      });

      return {
        ownership: newOwnership,
        buyerNewBalance: buyerBalance - 2,
        ownerUpdates,
        newOwnershipShare: newOwnerShare
      };
    });
  }

  /**
   * Post video from collection to Live TV (FREE - no cost)
   * Must be an owner of the video
   */
  async postToLiveTV(profileId: number, videoId: string) {
    return await prisma.$transaction(async (tx) => {
      // 1. Check if user owns this video
      const ownership = await tx.videoOwnership.findUnique({
        where: {
          profileId_videoId: {
            profileId,
            videoId
          }
        },
        include: { video: true }
      });

      if (!ownership) {
        throw new Error('You must own this video to post it to Live TV');
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

      return { queueItem, video: ownership.video };
    });
  }

  /**
   * Get user's owned videos (their collection)
   */
  async getUserCollection(profileId: number) {
    const ownerships = await prisma.videoOwnership.findMany({
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
            },
            owners: {
              include: {
                profile: {
                  select: {
                    id: true,
                    username: true,
                    profilePicture: true
                  }
                }
              },
              orderBy: {
                ownershipShare: 'desc'
              }
            }
          }
        }
      },
      orderBy: { acquiredAt: 'desc' }
    });

    return ownerships;
  }

  /**
   * Remove ownership from video (sell back)
   * Only works if user is not the sole owner
   */
  async removeFromCollection(profileId: number, videoId: string) {
    return await prisma.$transaction(async (tx) => {
      // Check if user owns the video
      const ownership = await tx.videoOwnership.findUnique({
        where: {
          profileId_videoId: {
            profileId,
            videoId
          }
        }
      });

      if (!ownership) {
        throw new Error('You do not own this video');
      }

      // Check total owners
      const totalOwners = await tx.videoOwnership.count({
        where: { videoId }
      });

      if (totalOwners === 1) {
        throw new Error('Cannot remove ownership: you are the sole owner. Delete the video instead.');
      }

      // Remove ownership
      await tx.videoOwnership.delete({
        where: {
          profileId_videoId: {
            profileId,
            videoId
          }
        }
      });

      // Redistribute shares among remaining owners proportionally
      const remainingOwners = await tx.videoOwnership.findMany({
        where: { videoId }
      });

      const totalRemainingShare = remainingOwners.reduce((sum, o) => sum + o.ownershipShare, 0);

      for (const owner of remainingOwners) {
        const newShare = (owner.ownershipShare / totalRemainingShare) * 100;
        await tx.videoOwnership.update({
          where: {
            profileId_videoId: {
              profileId: owner.profileId,
              videoId
            }
          },
          data: {
            ownershipShare: newShare
          }
        });
      }

      return { success: true };
    });
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
   * Get video details with ownership info
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
        },
        owners: {
          include: {
            profile: {
              select: {
                id: true,
                username: true,
                profilePicture: true
              }
            }
          },
          orderBy: {
            ownershipShare: 'desc'
          }
        }
      }
    });

    return video;
  }

  /**
   * Delete video (only if user is sole owner)
   */
  async deleteVideo(profileId: number, videoId: string) {
    return await prisma.$transaction(async (tx) => {
      const video = await tx.elsparkVideo.findUnique({
        where: { id: videoId }
      });

      if (!video) {
        throw new Error('Video not found');
      }

      // Check if user is an owner
      const ownership = await tx.videoOwnership.findUnique({
        where: {
          profileId_videoId: {
            profileId,
            videoId
          }
        }
      });

      if (!ownership) {
        throw new Error('You do not own this video');
      }

      // Check if sole owner
      const totalOwners = await tx.videoOwnership.count({
        where: { videoId }
      });

      if (totalOwners > 1) {
        throw new Error('Cannot delete video with multiple owners. Remove your ownership instead.');
      }

      // Remove from queue if exists
      await tx.liveTVQueue.deleteMany({
        where: { videoId }
      });

      // Remove ownership records
      await tx.videoOwnership.deleteMany({
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
      });

      await s3Client.send(command);

      const wasabiUrl = `https://s3.${WASABI_REGION}.wasabisys.com/${WASABI_BUCKET}/${key}`;
      console.log('Upload successful:', wasabiUrl);
      
      return wasabiUrl;
    } catch (error) {
      console.error('Error uploading to Wasabi:', error);
      throw new Error('Failed to upload video to storage');
    }
  }

  /**
   * Delete file from Wasabi S3
   */
  private async deleteFromWasabi(url: string): Promise<void> {
    try {
      let key: string;
      
      if (url.includes('.s3.wasabisys.com/')) {
        const urlParts = url.split('.s3.wasabisys.com/');
        key = urlParts[1];
      } else if (url.includes('s3.') && url.includes('.wasabisys.com/')) {
        const match = url.match(/wasabisys\.com\/[^\/]+\/(.+)/);
        key = match ? match[1] : '';
      } else {
        console.error('Invalid Wasabi URL format:', url);
        return;
      }

      if (!key) {
        console.error('Could not extract key from URL:', url);
        return;
      }

      const command = new DeleteObjectCommand({
        Bucket: WASABI_BUCKET,
        Key: key,
      });

      await s3Client.send(command);
      console.log('Successfully deleted from Wasabi:', key);
    } catch (error) {
      console.error('Error deleting from Wasabi:', error);
    }
  }

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

    const transactions = await prisma.coinTransaction.findMany({
      where: { accountId: profile.accountId },
      orderBy: { createdAt: 'desc' }
    });

    const ownerships = await prisma.videoOwnership.findMany({
      where: { profileId },
      include: {
        video: {
          select: {
            id: true,
            title: true
          }
        }
      },
      orderBy: { acquiredAt: 'desc' }
    });

    const activities = ownerships.map(ownership => ({
      type: ownership.acquisitionType === 'upload' ? 'upload' : 'purchase',
      amount: ownership.acquisitionType === 'upload' ? -1 : -2,
      description: ownership.acquisitionType === 'upload' 
        ? `Uploaded "${ownership.video.title}"`
        : `Purchased ${ownership.ownershipShare.toFixed(1)}% of "${ownership.video.title}"`,
      videoId: ownership.video.id,
      videoTitle: ownership.video.title,
      ownershipShare: ownership.ownershipShare,
      timestamp: ownership.acquiredAt
    }));

    return {
      currentBalance: profile.account.cyberCoins.toNumber(),
      stripeTransactions: transactions,
      elsparkActivities: activities
    };
  }
}