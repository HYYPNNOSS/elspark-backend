"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const notificationsRoutes_1 = require("./notificationsRoutes");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.get("/posts/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        res.status(400).json({ error: "Invalid post ID" });
        return;
    }
    const post = await prisma.post.findUnique({
        where: { id },
        include: { author: true, comments: true },
    });
    if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
    }
    res.json(post);
});
router.post('/collections', async (req, res) => {
    const { userId, title, postIds } = req.body;
    if (!userId || !title || !Array.isArray(postIds) || postIds.length !== 3) {
        res.status(400).json({ error: 'userId, title, and exactly 3 postIds required' });
        return;
    }
    try {
        const collection = await prisma.postCollection.create({
            data: {
                title,
                user: { connect: { id: userId } },
                posts: {
                    create: postIds.map(postId => ({
                        post: { connect: { id: postId } },
                    })),
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
                            },
                        },
                    },
                },
            },
        });
        res.json(collection);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create collection' });
    }
});
router.get("/allcollections", async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        const collections = await prisma.postCollection.findMany({
            select: {
                id: true,
                title: true,
                createdAt: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        profilePicture: true,
                    },
                },
                posts: {
                    select: {
                        post: {
                            select: {
                                id: true,
                                title: true,
                                text: true,
                                imageUrl: true,
                                videoUrl: true,
                                isPrivate: true,
                                createdAt: true,
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
                },
                _count: {
                    select: {
                        posts: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            skip: skip,
            take: limitNum,
        });
        const totalCount = await prisma.postCollection.count();
        const totalPages = Math.ceil(totalCount / limitNum);
        const transformedCollections = collections.map((collection) => ({
            id: collection.id,
            title: collection.title,
            createdAt: collection.createdAt,
            user: collection.user,
            posts: collection.posts,
            postsCount: collection._count.posts,
        }));
        console.log("Transformed collections:", JSON.stringify(transformedCollections, null, 2));
        res.status(200).json({
            collections: transformedCollections,
            pagination: {
                currentPage: pageNum,
                totalPages,
                totalCount,
                hasNextPage: pageNum < totalPages,
                hasPreviousPage: pageNum > 1,
            },
        });
    }
    catch (error) {
        console.error("Error fetching collections:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
router.get('/collections/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId);
    try {
        const collections = await prisma.postCollection.findMany({
            where: { userId },
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
                            },
                        },
                    },
                },
            },
        });
        res.json(collections);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch collections' });
    }
});
router.post('/collections/:collectionId/copy', async (req, res) => {
    const collectionId = parseInt(req.params.collectionId);
    const { userId } = req.body;
    if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
    }
    try {
        const originalCollection = await prisma.postCollection.findUnique({
            where: { id: collectionId },
            include: {
                posts: {
                    include: {
                        post: {
                            include: {
                                author: {
                                    include: {
                                        account: true
                                    }
                                },
                                coowners: true,
                            },
                        },
                    },
                },
                user: {
                    include: {
                        account: true
                    }
                },
            },
        });
        if (!originalCollection) {
            res.status(404).json({ error: 'Collection not found' });
            return;
        }
        const postsToCoown = originalCollection.posts.filter(postWrapper => {
            const post = postWrapper.post;
            const isAuthor = post.authorId === userId;
            const isAlreadyCoowner = post.coowners.some(coowner => coowner.userId === userId);
            return !isAuthor && !isAlreadyCoowner;
        });
        if (postsToCoown.length === 0) {
            res.status(400).json({ error: 'You are already author or co-owner of all posts in this collection' });
            return;
        }
        const uniqueAccountIds = new Map();
        for (const postWrapper of postsToCoown) {
            const author = postWrapper.post.author;
            if (author.id !== userId) {
                uniqueAccountIds.set(author.accountId, author.username);
            }
        }
        const recipientAccountIds = new Set([
            originalCollection.user.accountId,
            ...uniqueAccountIds.keys(),
        ]);
        const senderProfile = await prisma.profile.findUnique({
            where: { id: userId },
            include: { account: true },
        });
        if (!senderProfile) {
            res.status(404).json({ error: 'Sender profile not found' });
            return;
        }
        if (recipientAccountIds.has(senderProfile.accountId)) {
            recipientAccountIds.delete(senderProfile.accountId);
        }
        const requiredCoins = recipientAccountIds.size * 0.5;
        const senderCoins = Number(senderProfile.account.cyberCoins);
        if (senderCoins < requiredCoins) {
            res.status(400).json({ error: `You need at least ${requiredCoins} CyberCoins to co-own these posts.` });
            return;
        }
        const transactionOps = [];
        transactionOps.push(prisma.account.update({
            where: { id: senderProfile.accountId },
            data: { cyberCoins: { decrement: requiredCoins } },
        }));
        for (const recipientAccountId of recipientAccountIds) {
            transactionOps.push(prisma.account.update({
                where: { id: recipientAccountId },
                data: { cyberCoins: { increment: 0.5 } },
            }));
        }
        for (const postWrapper of postsToCoown) {
            transactionOps.push(prisma.postCoowner.create({
                data: {
                    postId: postWrapper.post.id,
                    userId: userId,
                },
            }));
        }
        await prisma.$transaction(transactionOps);
        if (recipientAccountIds.has(originalCollection.user.accountId)) {
            await (0, notificationsRoutes_1.createNotification)('coowner', `${senderProfile.username} purchased a copy of your digi-cura-post collection: ${originalCollection.title}`, originalCollection.user.id, undefined, undefined, `/profile/${senderProfile.username}`);
        }
        const updatedPosts = await prisma.post.findMany({
            where: {
                id: { in: postsToCoown.map(p => p.post.id) },
            },
            include: {
                author: {
                    select: { id: true, username: true },
                },
                coowners: {
                    include: {
                        user: {
                            select: { id: true, username: true },
                        },
                    },
                },
            },
        });
        res.json({
            message: `You are now co-owner of ${postsToCoown.length} posts. ${requiredCoins} CyberCoins distributed.`,
            coownedPosts: updatedPosts,
            coinsSpent: requiredCoins,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create co-owned posts' });
    }
});
router.post('/collections/:collectionId/copy', async (req, res) => {
    const collectionId = parseInt(req.params.collectionId);
    const { userId } = req.body;
    if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
    }
    try {
        const originalCollection = await prisma.postCollection.findUnique({
            where: { id: collectionId },
            include: {
                posts: {
                    include: {
                        post: {
                            include: {
                                author: {
                                    include: {
                                        account: true
                                    }
                                },
                                coowners: true,
                            },
                        },
                    },
                },
                user: {
                    include: {
                        account: true
                    }
                },
            },
        });
        if (!originalCollection) {
            res.status(404).json({ error: 'Collection not found' });
            return;
        }
        const postsToCoown = originalCollection.posts.filter(postWrapper => {
            const post = postWrapper.post;
            const isAuthor = post.authorId === userId;
            const isAlreadyCoowner = post.coowners.some(coowner => coowner.userId === userId);
            return !isAuthor && !isAlreadyCoowner;
        });
        if (postsToCoown.length === 0) {
            res.status(400).json({ error: 'You are already author or co-owner of all posts in this collection' });
            return;
        }
        const uniqueAccountIds = new Map();
        for (const postWrapper of postsToCoown) {
            const author = postWrapper.post.author;
            if (author.id !== userId) {
                uniqueAccountIds.set(author.accountId, author.username);
            }
        }
        const recipientAccountIds = new Set([
            originalCollection.user.accountId,
            ...uniqueAccountIds.keys(),
        ]);
        const senderProfile = await prisma.profile.findUnique({
            where: { id: userId },
            include: { account: true },
        });
        if (!senderProfile) {
            res.status(404).json({ error: 'Sender profile not found' });
            return;
        }
        if (recipientAccountIds.has(senderProfile.accountId)) {
            recipientAccountIds.delete(senderProfile.accountId);
        }
        const requiredCoins = recipientAccountIds.size * 0.5;
        const senderCoins = Number(senderProfile.account.cyberCoins);
        if (senderCoins < requiredCoins) {
            res.status(400).json({ error: `You need at least ${requiredCoins} CyberCoins to co-own these posts.` });
            return;
        }
        const transactionOps = [];
        transactionOps.push(prisma.account.update({
            where: { id: senderProfile.accountId },
            data: { cyberCoins: { decrement: requiredCoins } },
        }));
        for (const recipientAccountId of recipientAccountIds) {
            transactionOps.push(prisma.account.update({
                where: { id: recipientAccountId },
                data: { cyberCoins: { increment: 0.5 } },
            }));
        }
        for (const postWrapper of postsToCoown) {
            transactionOps.push(prisma.postCoowner.create({
                data: {
                    postId: postWrapper.post.id,
                    userId: userId,
                },
            }));
        }
        await prisma.$transaction(transactionOps);
        if (recipientAccountIds.has(originalCollection.user.accountId)) {
            await (0, notificationsRoutes_1.createNotification)('coowner', `${senderProfile.username} purchased a copy of your digi-cura-post collection: ${originalCollection.title}`, originalCollection.user.id, undefined, undefined, `/profile/${senderProfile.username}`);
        }
        const updatedPosts = await prisma.post.findMany({
            where: {
                id: { in: postsToCoown.map(p => p.post.id) },
            },
            include: {
                author: {
                    select: { id: true, username: true },
                },
                coowners: {
                    include: {
                        user: {
                            select: { id: true, username: true },
                        },
                    },
                },
            },
        });
        res.json({
            message: `You are now co-owner of ${postsToCoown.length} posts. ${requiredCoins} CyberCoins distributed.`,
            coownedPosts: updatedPosts,
            coinsSpent: requiredCoins,
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create co-owned posts' });
    }
});
router.get('/collections/public/browse', async (req, res) => {
    const { userId } = req.query;
    try {
        const collections = await prisma.postCollection.findMany({
            where: userId && typeof userId === 'string' ? {
                userId: { not: parseInt(userId, 10) }
            } : {},
            include: {
                posts: {
                    include: {
                        post: true,
                    },
                },
                user: {
                    select: {
                        id: true,
                        username: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        res.json(collections);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch public collections' });
    }
});
exports.default = router;
