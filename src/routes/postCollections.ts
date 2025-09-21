import express, { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const router = express.Router()

const prisma = new PrismaClient()

// Create new post collection

// ✅ Specific routes come first

// 👇 Put this AFTER so it doesn’t eat `/public`
router.get("/posts/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid post ID" });
    return
  }

  const post = await prisma.post.findUnique({
    where: { id },
    include: { author: true, comments: true },
  });

  if (!post)
  {
    res.status(404).json({ error: "Post not found" });

    return 
  }
  res.json(post);
});


router.post('/collections', async (req, res) => {
  const { userId, title, postIds } = req.body

  if (!userId || !title || !Array.isArray(postIds) || postIds.length !== 3) {
    res.status(400).json({ error: 'userId, title, and exactly 3 postIds required' })
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
        posts: {
          include: { post: true },
        },
      },
    })

    res.json(collection)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to create collection' })
  }
})


router.get("/allcollections", async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
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

    // Get total count for pagination
    const totalCount = await prisma.postCollection.count();
    const totalPages = Math.ceil(totalCount / limitNum);

    // Transform to match frontend expectations - keep the posts structure intact
    const transformedCollections = collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      createdAt: collection.createdAt,
      user: collection.user,
      posts: collection.posts, // Keep the original structure with post wrapper
      postsCount: collection._count.posts,
    }));

    console.log("Transformed collections:", JSON.stringify(transformedCollections, null, 2));

    // Return collections directly in the expected format
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
  } catch (error) {
    console.error("Error fetching collections:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user collections
router.get('/collections/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId)

  try {
    const collections = await prisma.postCollection.findMany({
      where: { userId },
      include: {
        posts: {
          include: {
            post: {
              include: {
                author: true,
              },
            },
          },
        },
      },
    })

    res.json(collections)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch collections' })
  }
})

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
                author: true,
                coowners: true, // Check existing co-owners
              },
            },
          },
        },
        user: true, // Collection owner
      },
    });

    if (!originalCollection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    // Filter out posts where user is already a co-owner or author
    const postsToCoown = originalCollection.posts.filter(postWrapper => {
      const post = postWrapper.post;
      const isAuthor = post.authorId === userId;
      const isAlreadyCoowner = post.coowners.some(coowner => coowner.userId === userId);
      return !isAuthor && !isAlreadyCoowner;
    });

    // Only block if user already owns/co-owns ALL posts in the collection
    if (postsToCoown.length === 0) {
      res.status(400).json({ error: 'You are already author or co-owner of all posts in this collection' });
      return;
    }

    // Calculate unique recipients for coin distribution
    const uniqueAuthors = new Map<number, string>();
    for (const postWrapper of postsToCoown) {
      const author = postWrapper.post.author;
      if (author.id !== userId) {
        uniqueAuthors.set(author.id, author.username);
      }
    }

    const recipientIds = new Set<number>([
      originalCollection.user.id, // Collection owner
      ...uniqueAuthors.keys(), // Post authors
    ]);

    if (recipientIds.has(userId)) {
      recipientIds.delete(userId); // Don't pay yourself
    }

    const requiredCoins = recipientIds.size;
    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, cyberCoins: true },
    });

    if (!sender) {
      res.status(404).json({ error: 'Sender not found' });
      return;
    }

    if (sender.cyberCoins < requiredCoins) {
      res.status(400).json({ error: `You need at least ${requiredCoins} CyberCoins to co-own these posts.` });
      return;
    }

    // Start transaction for coin transfers + co-ownership creation
    const transactionOps = [];

    // Decrement coins from sender
    transactionOps.push(
      prisma.user.update({
        where: { id: userId },
        data: { cyberCoins: { decrement: requiredCoins } },
      })
    );

    // Send 1 coin to each recipient
    for (const recipientId of recipientIds) {
      transactionOps.push(
        prisma.user.update({
          where: { id: recipientId },
          data: { cyberCoins: { increment: 0.5 } },
        })
      );
    }

    // Create co-ownership records for each post
    for (const postWrapper of postsToCoown) {
      transactionOps.push(
        prisma.postCoowner.create({
          data: {
            postId: postWrapper.post.id,
            userId: userId,
          },
        })
      );
    }

    await prisma.$transaction(transactionOps);

    // Fetch the updated posts with co-owners to return
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
    // bomboclat
    res.json({
      message: `You are now co-owner of ${postsToCoown.length} posts. ${requiredCoins} CyberCoins distributed.`,
      coownedPosts: updatedPosts,
      coinsSpent: requiredCoins,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create co-owned posts' });
  }
});

router.get('/collections/public/browse', async (req, res) => {
  const { userId } = req.query 
  
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
    })
    
    res.json(collections)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch public collections' })
  }
})

// ✅ Always put this first





// Get all collections endpoint


export default router