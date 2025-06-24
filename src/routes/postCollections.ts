import express from 'express'
import { PrismaClient } from '@prisma/client'

const router = express.Router()

const prisma = new PrismaClient()

// Create new post collection
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
                author: true, // ✅ Include author relation inside post
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

// router.post('/collections/:collectionId/copy', async (req, res) => {
//   const collectionId = parseInt(req.params.collectionId)
//   const { userId, newTitle } = req.body
  
//   if (!userId) {
//     res.status(400).json({ error: 'userId is required' })
//     return;
//   }
  
//   try {
    
//     const originalCollection = await prisma.postCollection.findUnique({
//       where: { id: collectionId },
//       include: {
//         posts: {
//           include: {
//             post: true,
//           },
//         },
//       },
//     })
    
//     if (!originalCollection) {
//       res.status(404).json({ error: 'Collection not found' })
//       return;
//     }
    
    
//     if (originalCollection.userId === userId) {
//       res.status(400).json({ error: 'Cannot copy your own collection' })
//       return;
//     }
    
    
//     const postIds = originalCollection.posts.map(p => p.post.id)
    
    
//     const collectionTitle = newTitle || `Copy of ${originalCollection.title}`
    
    
//     const existingCollection = await prisma.postCollection.findFirst({
//       where: {
//         userId: userId,
//         title: collectionTitle,
//       },
//     })
    
//     if (existingCollection) {
//       res.status(400).json({ error: 'You already have a collection with this title' })
//       return;
//     }
    
//     const newCollection = await prisma.postCollection.create({
//       data: {
//         title: collectionTitle,
//         user: { connect: { id: userId } },
//         posts: {
//           create: postIds.map(postId => ({
//             post: { connect: { id: postId } },
//           })),
//         },
//       },
//       include: {
//         posts: {
//           include: {
//             post: true,
//           },
//         },
//         user: {
//           select: {
//             id: true,
//             username: true,
//           },
//         },
//       },
//     })
    
//     res.json({
//       message: 'Collection copied successfully',
//       collection: newCollection,
//     })
//   } catch (err) {
//     console.error(err)
//     res.status(500).json({ error: 'Failed to copy collection' })
//   }
// })


router.post('/collections/:collectionId/copy', async (req, res) => {
  const collectionId = parseInt(req.params.collectionId);
  const { userId, newTitle } = req.body;

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
              },
            },
          },
        },
        user: true, // for profileUser.id
      },
    });

    if (!originalCollection) {
      res.status(404).json({ error: 'Collection not found' });
    return;
      
    }

    if (originalCollection.userId === userId) {
      res.status(400).json({ error: 'Cannot copy your own collection' });
    return;
      
    }

    const uniqueAuthors = new Map<number, string>();
    for (const postWrapper of originalCollection.posts) {
      const author = postWrapper.post.author;
      if (author.id !== userId) {
        uniqueAuthors.set(author.id, author.username);
      }
    }

    const recipientIds = new Set<number>([
      originalCollection.user.id, // profileUser
      ...uniqueAuthors.keys(),
    ]);

    if (recipientIds.has(userId)) {
      recipientIds.delete(userId); // do not pay yourself
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
      res.status(400).json({ error: `You need at least ${requiredCoins} CyberCoins to copy this collection.` });
    return;
      
    }

    // Check for duplicate collection title
    const existing = await prisma.postCollection.findFirst({
      where: { userId, title: newTitle },
    });

    if (existing) {
      res.status(400).json({ error: 'You already have a collection with this title' });
    return;
      
    }

    const postIds = originalCollection.posts.map(p => p.post.id);

    // Start transaction for both coin transfers + collection creation
    const transactionOps = [];

    // Decrement from sender
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
          data: { cyberCoins: { increment: 1 } },
        })
      );
    }

    // Create collection
    transactionOps.push(
      prisma.postCollection.create({
        data: {
          title: newTitle || `Copy of ${originalCollection.title}`,
          user: { connect: { id: userId } },
          posts: {
            create: postIds.map(postId => ({
              post: { connect: { id: postId } },
            })),
          },
        },
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
          user: {
            select: { id: true, username: true },
          },
        },
      })
    );

    const results = await prisma.$transaction(transactionOps);
    const newCollection = results[results.length - 1];

    res.json({
      message: `Collection copied and ${requiredCoins} CyberCoins distributed.`,
      collection: newCollection,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to copy collection' });
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

export default router
