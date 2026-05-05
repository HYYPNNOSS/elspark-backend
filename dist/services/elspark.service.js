"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElsparkService = void 0;
const client_1 = require("@prisma/client");
const fs_1 = __importDefault(require("fs"));
const client_s3_1 = require("@aws-sdk/client-s3");
const prisma = new client_1.PrismaClient();
// Wasabi S3 Configuration
const s3Client = new client_s3_1.S3Client({
    endpoint: process.env.WASABI_ENDPOINT || "https://s3.eu-west-1.wasabisys.com",
    region: process.env.WASABI_REGION || "eu-west-1",
    credentials: {
        accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
        secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
    },
});
const WASABI_BUCKET = process.env.WASABI_BUCKET_NAME || "elspark";
const WASABI_REGION = process.env.WASABI_REGION || "eu-west-1";
class ElsparkService {
    /**
     * Upload video to user's collection (costs 1 cyberCoin)
     * User becomes the initial owner with 100% ownership
     */
    async uploadToCollection(profileId, videoFile, title, description) {
        // ✅ Move ALL heavy operations BEFORE the transaction
        console.log('[UPLOAD] Starting pre-transaction operations...');
        // 1. Get video duration FIRST
        const duration = await this.getVideoDuration(videoFile.path);
        console.log('[UPLOAD] Got duration:', duration);
        // 2. Upload to Wasabi FIRST
        const wasabiKey = `collections/${profileId}/${Date.now()}-${videoFile.originalname}`;
        const wasabiUrl = await this.uploadToWasabi(videoFile, wasabiKey);
        console.log('[UPLOAD] Uploaded to Wasabi:', wasabiUrl);
        // 3. Delete temp file FIRST
        if (fs_1.default.existsSync(videoFile.path)) {
            fs_1.default.unlinkSync(videoFile.path);
        }
        // ✅ Now run a FAST transaction with just database operations
        console.log('[UPLOAD] Starting transaction...');
        try {
            return await prisma.$transaction(async (tx) => {
                // Fast DB operations only
                const profile = await tx.profile.findUnique({
                    where: { id: profileId },
                    include: { account: true }
                });
                if (!profile) {
                    throw new Error('Profile not found');
                }
                const balance = profile.account.cyberCoins.toNumber();
                // if (balance < 1) {
                //   throw new Error('Insufficient cyberCoins. You need 1 cyberCoin to upload.');
                // }
                // await tx.account.update({
                //   where: { id: profile.accountId },
                //   data: { cyberCoins: { decrement: 1 } }
                // });
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
                        status: 'collection' // Changed from 'in_collection'
                    }
                });
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
                    newBalance: balance
                };
            }, {
                timeout: 10000 // Reduced to 10 seconds - should be plenty for DB ops only
            });
        }
        catch (error) {
            // If transaction fails, clean up the uploaded file from Wasabi
            console.error('[UPLOAD] Transaction failed, cleaning up Wasabi upload...');
            await this.deleteFromWasabi(wasabiUrl);
            throw error;
        }
    }
    /**
   * Add video from URL (no upload cost, just fetches metadata)
   */
    async addVideoFromUrl(profileId, videoUrl, title, description) {
        console.log('[ADD URL] Starting URL video addition...');
        // Basic URL validation
        if (!videoUrl.match(/^https?:\/\/.+/)) {
            throw new Error('Invalid URL format');
        }
        // For now, we'll store the URL directly
        // In production, you might want to:
        // 1. Download and re-upload to Wasabi for reliability
        // 2. Use a video metadata API to get duration
        // 3. Validate the URL is actually a video
        return await prisma.$transaction(async (tx) => {
            const profile = await tx.profile.findUnique({
                where: { id: profileId },
                include: { account: true }
            });
            if (!profile) {
                throw new Error('Profile not found');
            }
            // Create video record with URL source
            const video = await tx.elsparkVideo.create({
                data: {
                    title,
                    description,
                    url: videoUrl,
                    sourceUrl: videoUrl,
                    filename: new URL(videoUrl).pathname.split('/').pop() || 'url-video',
                    duration: await this.getVideoDurationFromUrl(videoUrl),
                    fileSize: 0,
                    uploaderId: profileId,
                    source: 'url',
                    status: 'collection' // Changed from 'in_collection'
                }
            });
            // Create ownership
            await tx.videoOwnership.create({
                data: {
                    videoId: video.id,
                    profileId,
                    ownershipShare: 100.0,
                    acquisitionType: 'upload',
                    acquisitionPrice: 0 // Free for URL imports
                }
            });
            return {
                video,
                newBalance: profile.account.cyberCoins.toNumber()
            };
        });
    }
    /**
     * Fetch video duration from URL using ffprobe
     * (Only works if server can access the URL)
     */
    async getVideoDurationFromUrl(url) {
        try {
            const ffprobe = require('ffprobe');
            const ffprobeStatic = require('ffprobe-static');
            const info = await ffprobe(url, { path: ffprobeStatic.path });
            const duration = info.streams[0].duration;
            return duration ? parseFloat(duration) : 0;
        }
        catch (error) {
            console.error('Error getting video duration from URL:', error);
            return 0; // Default to 0 if can't fetch
        }
    }
    /**
     * Purchase video for collection (costs 2 cyberCoins)
     * Distributes revenue among all existing owners based on ownership share
     * Buyer receives ownership share based on total owners
     */
    async purchaseVideo(profileId, videoId) {
        return await prisma.$transaction(async (tx) => {
            // 1-4. Same as before (get buyer, video, check ownership, check balance)
            const buyer = await tx.profile.findUnique({
                where: { id: profileId },
                include: { account: true }
            });
            if (!buyer) {
                throw new Error('Profile not found');
            }
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
            const buyerBalance = buyer.account.cyberCoins.toNumber();
            if (buyerBalance < 2) {
                throw new Error('Insufficient cyberCoins. You need 2 cyberCoins to purchase.');
            }
            // 5. Get the current queue item to find who posted it
            const currentQueueItem = await tx.liveTVQueue.findFirst({
                where: {
                    videoId,
                    status: { in: ['waiting', 'playing'] }
                }
            });
            const reposterId = currentQueueItem?.uploaderId;
            const originalOwnerId = video.uploaderId; // Original video owner
            // 6. Deduct 2 cyberCoins from buyer
            await tx.account.update({
                where: { id: buyer.accountId },
                data: {
                    cyberCoins: {
                        decrement: 2
                    }
                }
            });
            // 7. Distribute coins: 1 to reposter, 1 to original owner
            const ownerUpdates = [];
            if (reposterId && reposterId !== originalOwnerId) {
                // Different people - give 1 coin to each
                // Give 1 coin to reposter
                const reposter = await tx.profile.findUnique({
                    where: { id: reposterId },
                    include: { account: true }
                });
                if (reposter) {
                    await tx.account.update({
                        where: { id: reposter.accountId },
                        data: {
                            cyberCoins: {
                                increment: 1
                            }
                        }
                    });
                    ownerUpdates.push({
                        profileId: reposterId,
                        amount: 1,
                        newBalance: reposter.account.cyberCoins.toNumber() + 1
                    });
                }
                // Give 1 coin to original owner
                await tx.account.update({
                    where: { id: video.uploader.accountId },
                    data: {
                        cyberCoins: {
                            increment: 1
                        }
                    }
                });
                ownerUpdates.push({
                    profileId: originalOwnerId,
                    amount: 1,
                    newBalance: video.uploader.account.cyberCoins.toNumber() + 1
                });
            }
            else {
                // Same person (or no queue item) - give all 2 coins to original owner
                await tx.account.update({
                    where: { id: video.uploader.accountId },
                    data: {
                        cyberCoins: {
                            increment: 2
                        }
                    }
                });
                ownerUpdates.push({
                    profileId: originalOwnerId,
                    amount: 2,
                    newBalance: video.uploader.account.cyberCoins.toNumber() + 2
                });
            }
            // 8-10. Keep same ownership logic or simplify if you want
            const newOwnerShare = 50; // Or calculate based on your needs
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
                newOwnershipShare: newOwnerShare,
                reposterId
            };
        });
    }
    /**
     * Post video from collection to Live TV (FREE - no cost)
     * Must be an owner of the video
     */
    async postToLiveTV(profileId, videoId) {
        const result = await prisma.$transaction(async (tx) => {
            // Check ownership
            const ownership = await tx.videoOwnership.findUnique({
                where: {
                    profileId_videoId: {
                        profileId,
                        videoId
                    }
                },
                include: {
                    video: true,
                    profile: {
                        include: { account: true }
                    }
                }
            });
            if (!ownership) {
                throw new Error('You must own this video to post it to Live TV');
            }
            // Check balance for posting cost (1 coin)
            const balance = ownership.profile.account.cyberCoins.toNumber();
            if (balance < 1) {
                throw new Error('Insufficient cyberCoins. You need 1 cyberCoin to post to Live TV.');
            }
            // Deduct 1 coin for posting
            await tx.account.update({
                where: { id: ownership.profile.accountId },
                data: { cyberCoins: { decrement: 1 } }
            });
            // Check if video already in queue
            const existingQueue = await tx.liveTVQueue.findFirst({
                where: {
                    videoId,
                    status: { in: ['waiting', 'playing'] }
                }
            });
            if (existingQueue) {
                throw new Error('Video is already in the queue');
            }
            // Add to queue
            const lastQueueItem = await tx.liveTVQueue.findFirst({
                orderBy: { position: 'desc' }
            });
            const nextPosition = lastQueueItem ? lastQueueItem.position + 1 : 1;
            const queueItem = await tx.liveTVQueue.create({
                data: {
                    videoId,
                    position: nextPosition,
                    status: 'waiting',
                    uploaderId: profileId
                }
            });
            await tx.elsparkVideo.update({
                where: { id: videoId },
                data: { status: 'queued' } // Temporarily set to queued while in queue
            });
            const currentlyPlaying = await tx.liveTVQueue.findFirst({
                where: { status: 'playing' }
            });
            return {
                queueItem,
                video: ownership.video,
                shouldStartPlayback: !currentlyPlaying,
                newBalance: balance - 1
            };
        });
        return result;
    }
    // async postToLiveTV(profileId: number, videoId: string) {
    //   const result = await prisma.$transaction(async (tx) => {
    //     const ownership = await tx.videoOwnership.findUnique({
    //       where: {
    //         profileId_videoId: {
    //           profileId,
    //           videoId
    //         }
    //       },
    //       include: { video: true }
    //     });
    //     if (!ownership) {
    //       throw new Error('You must own this video to post it to Live TV');
    //     }
    //     const existingQueue = await tx.liveTVQueue.findFirst({
    //       where: {
    //         videoId,
    //         status: { in: ['waiting', 'playing'] }
    //       }
    //     });
    //     if (existingQueue) {
    //       throw new Error('Video is already in the queue');
    //     }
    //     const lastQueueItem = await tx.liveTVQueue.findFirst({
    //       orderBy: { position: 'desc' }
    //     });
    //     const nextPosition = lastQueueItem ? lastQueueItem.position + 1 : 1;
    //     const queueItem = await tx.liveTVQueue.create({
    //       data: {
    //         videoId,
    //         position: nextPosition,
    //         status: 'waiting',
    //         uploaderId: profileId
    //       }
    //     });
    //     await tx.elsparkVideo.update({
    //       where: { id: videoId },
    //       data: { status: 'queued' }
    //     });
    //     const currentlyPlaying = await tx.liveTVQueue.findFirst({
    //       where: { status: 'playing' }
    //     });
    //     return { 
    //       queueItem, 
    //       video: ownership.video,
    //       shouldStartPlayback: !currentlyPlaying
    //     };
    //   });
    //   return result;
    // }
    // nooo
    /**
     * Get user's owned videos (their collection)
     */
    async getUserCollection(profileId) {
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
    async removeFromCollection(profileId, videoId) {
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
    // In elspark.service.ts - getCurrentVideo method
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
    async getHistory(limit = 20) {
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
    async getVideoDetails(videoId) {
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
    async deleteVideo(profileId, videoId) {
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
    async getCoinBalance(profileId) {
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
    async getVideoDuration(filePath) {
        try {
            const ffprobe = require('ffprobe');
            const ffprobeStatic = require('ffprobe-static');
            const info = await ffprobe(filePath, { path: ffprobeStatic.path });
            const duration = info.streams[0].duration;
            return duration ? parseFloat(duration) : 0;
        }
        catch (error) {
            console.error('Error getting video duration:', error);
            return 0;
        }
    }
    /**
     * Upload file to Wasabi S3
     */
    async uploadToWasabi(file, key) {
        try {
            const fileContent = fs_1.default.readFileSync(file.path);
            const command = new client_s3_1.PutObjectCommand({
                Bucket: WASABI_BUCKET,
                Key: key,
                Body: fileContent,
                ContentType: file.mimetype,
            });
            await s3Client.send(command);
            const wasabiUrl = `https://s3.${WASABI_REGION}.wasabisys.com/${WASABI_BUCKET}/${key}`;
            console.log('Upload successful:', wasabiUrl);
            return wasabiUrl;
        }
        catch (error) {
            console.error('Error uploading to Wasabi:', error);
            throw new Error('Failed to upload video to storage');
        }
    }
    /**
   * Get random videos from collections for filler content
   * Prioritizes videos that haven't been played recently
   * IMPROVED: Better handling of empty results and video cycling
   */
    async getFillerVideos(limit = 10, excludeIds = []) {
        console.log(`[GET FILLER] Fetching up to ${limit} videos, excluding ${excludeIds.length} IDs`);
        // Get ALL videos from database first
        const allVideos = await prisma.elsparkVideo.findMany({
            where: {
                status: 'collection',
                uploaderId: 5,
                id: {
                    notIn: excludeIds.length > 0 ? excludeIds : undefined
                }
            },
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
        console.log(`[GET FILLER] Found ${allVideos.length} videos (excluding ${excludeIds.length} already queued)`);
        if (allVideos.length === 0) {
            console.log('[GET FILLER] ⚠️  No videos found with exclusions, resetting cycle...');
            // If no videos with exclusions, get ALL videos (reset the cycle)
            const resetVideos = await prisma.elsparkVideo.findMany({
                where: {
                    status: 'queued',
                    uploaderId: 5
                },
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
            console.log(`[GET FILLER] 🔄 Reset cycle - found ${resetVideos.length} total videos`);
            if (resetVideos.length === 0) {
                console.log('[GET FILLER] ❌ NO VIDEOS IN DATABASE AT ALL');
                return [];
            }
            // Shuffle and return
            const shuffled = [...resetVideos];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const result = shuffled.slice(0, Math.min(limit, shuffled.length));
            console.log(`[GET FILLER] ✅ Returning ${result.length} shuffled videos (after reset)`);
            console.log(`[GET FILLER] 🎬 Next videos: ${result.slice(0, 3).map(v => v.title).join(', ')}...`);
            return result;
        }
        // Shuffle using Fisher-Yates algorithm for true randomness
        const shuffled = [...allVideos];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        // Return up to 'limit' videos
        const result = shuffled.slice(0, Math.min(limit, shuffled.length));
        console.log(`[GET FILLER] ✅ Returning ${result.length} shuffled videos`);
        console.log(`[GET FILLER] 🎬 Next videos: ${result.slice(0, 3).map(v => v.title).join(', ')}...`);
        return result;
    }
    /**
     * Mark video as played in filler rotation
     */
    async markFillerVideoPlayed(videoId) {
        await prisma.elsparkVideo.update({
            where: { id: videoId },
            data: { lastPlayedInFiller: new Date() }
        });
    }
    /**
     * Delete file from Wasabi S3
     */
    async deleteFromWasabi(url) {
        try {
            let key;
            if (url.includes('.s3.wasabisys.com/')) {
                const urlParts = url.split('.s3.wasabisys.com/');
                key = urlParts[1];
            }
            else if (url.includes('s3.') && url.includes('.wasabisys.com/')) {
                const match = url.match(/wasabisys\.com\/[^\/]+\/(.+)/);
                key = match ? match[1] : '';
            }
            else {
                console.error('Invalid Wasabi URL format:', url);
                return;
            }
            if (!key) {
                console.error('Could not extract key from URL:', url);
                return;
            }
            const command = new client_s3_1.DeleteObjectCommand({
                Bucket: WASABI_BUCKET,
                Key: key,
            });
            await s3Client.send(command);
            console.log('Successfully deleted from Wasabi:', key);
        }
        catch (error) {
            console.error('Error deleting from Wasabi:', error);
        }
    }
    /**
     * Get transaction history for a user
     */
    async getTransactionHistory(profileId) {
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
exports.ElsparkService = ElsparkService;
