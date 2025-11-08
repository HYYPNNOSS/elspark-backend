// routes/postRouter.ts
import express from "express";
import multer from "multer";
import path from "path";
import { verifyToken } from "../middlewares/authMiddleware";
import { PrismaClient } from "@prisma/client";

const postRouter = express.Router();
const prisma = new PrismaClient();

import { postMediaUpload, getWasabiUrl } from "../config/wasabi-config";

postRouter.post(
  "/",
  verifyToken,
  postMediaUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  async (req: express.Request, res: express.Response) => {
    const { text, title, isPrivate } = req.body;
    const user = (req as any).user;

    if (!user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const imageFile = files?.["image"]?.[0] as Express.MulterS3.File | undefined;
      const videoFile = files?.["video"]?.[0] as Express.MulterS3.File | undefined;

      // Extract the key from location and prepend /elspark
      const imageUrl = imageFile ? imageFile.key : null;
const videoUrl = videoFile ? videoFile.key : null;

      const newPost = await prisma.post.create({
        data: {
          text,
          title,
          imageUrl,
          videoUrl,
          isPrivate: isPrivate === "true",
          authorId: user.id,
        },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
            },
          },
        },
      });

      res.status(201).json(newPost);
    } catch (error) {
      console.error("Failed to create post:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

postRouter.get(
  "/:id",
  verifyToken, 
  async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    console.log("heyy")
    
    const postId = parseInt(id);

    if (!postId || isNaN(postId)) {
      res.status(400).json({ error: "Invalid post ID" });
      return
    }

    try {
      const post = await prisma.post.findUnique({
        where: {
          id: postId,
        },
        include: {
          
          author: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
              bio: true,
              createdAt: true,
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
          
          collections: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          
          comments: {
            where: {
              parentId: null, 
            },
            include: {
              author: {
                select: {
                  id: true,
                  username: true,
                  profilePicture: true,
                },
              },
              
              replies: {
                include: {
                  author: {
                    select: {
                      id: true,
                      username: true,
                      profilePicture: true,
                    },
                  },
                  replies: {
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
                      createdAt: "asc",
                    },
                  },
                },
                orderBy: {
                  createdAt: "asc",
                },
              },
            },
            orderBy: {
              createdAt: "desc", 
            },
          },
          // Post in collections relationship
          PostInCollection: {
            include: {
              collection: {
                select: {
                  id: true,
                  title: true,
                  userId: true,
                },
              },
            },
          },
        },
      });

      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return
      }

      // Optional: Check if post is private and user has access
      const user = (req as any).user;
      if (post.isPrivate) {
        const hasAccess = 
          user?.id === post.authorId || // Author
          post.coowners.some(coowner => coowner.userId === user?.id); // Co-owner
        
        if (!hasAccess) {
          res.status(403).json({ error: "Access denied to private post" });
          return
        }
      }

      // Add some computed fields for convenience
      const enrichedPost = {
        ...post,
        stats: {
          commentCount: await prisma.comment.count({
            where: { postId: post.id },
          }),
          coownerCount: post.coowners.length,
          collectionCount: post.collections.length,
        },
        hasMedia: {
          hasImage: !!post.imageUrl,
          hasVideo: !!post.videoUrl,
        },
      };

      res.status(200).json(enrichedPost);
    } catch (error) {
      console.error("Failed to fetch post:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);


// Add to postRouter.ts

postRouter.delete(
  "/:id",
  verifyToken,
  async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    const postId = parseInt(id);

    if (!postId || isNaN(postId)) {
      res.status(400).json({ error: "Invalid post ID" });
      return;
    }

    try {
      // Find the post and check ownership - INCLUDE AUTHOR
      const post = await prisma.post.findUnique({
        where: { id: postId },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
            },
          },
          coowners: true,
        },
      });

      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      // Check if user is owner or coowner
      const isOwner = post.authorId === user.id;
      const isCoowner = post.coowners.some(co => co.userId === user.id);

      if (!isOwner && !isCoowner) {
        res.status(403).json({ error: "Unauthorized to delete this post" });
        return;
      }

      // If user is a coowner, just remove them from coowners
      if (isCoowner && !isOwner) {
        await prisma.postCoowner.delete({
          where: {
            postId_userId: {
              postId: postId,
              userId: user.id,
            },
          },
        });

        res.status(200).json({ 
          message: "Removed from coowners successfully",
          isAnonymized: false 
        });
        return;
      }

      // If user is the original author, anonymize the post
      if (isOwner) {
        // Remove all coowners
        await prisma.postCoowner.deleteMany({
          where: { postId: postId },
        });

        // Update post to be anonymous
        const updatedPost = await prisma.post.update({
          where: { id: postId },
          data: {
            isAnonymous: true,
            originalAuthorId: post.authorId,
            deletedAt: new Date(),
          },
        });

        res.status(200).json({ 
          message: "Post anonymized successfully",
          isAnonymized: true,
          post: updatedPost 
        });
        return;
      }

    } catch (error) {
      console.error("Failed to delete/anonymize post:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// Alternative version that gets ALL comments in a flat structure (if you prefer)
postRouter.get(
  "/:id/with-flat-comments",
  verifyToken,
  async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const postId = parseInt(id);

    if (!postId || isNaN(postId)) {
      res.status(400).json({ error: "Invalid post ID" });
      return;
    }

    try {
      const post = await prisma.post.findUnique({
        where: {
          id: postId,
        },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              profilePicture: true,
              bio: true,
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
          collections: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
        },
      });

      if (!post) {
        res.status(404).json({ error: "Post not found" });
        return;
      }

      // Get all comments for this post in a flat structure
      const allComments = await prisma.comment.findMany({
        where: {
          postId: post.id,
        },
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
          createdAt: "asc",
        },
      });

      // Check privacy access
      const user = (req as any).user;
      if (post.isPrivate) {
        const hasAccess = 
          user?.id === post.authorId || 
          post.coowners.some(coowner => coowner.userId === user?.id);
        
        if (!hasAccess) {
          res.status(403).json({ error: "Access denied to private post" });
          return
        }
      }

      const response = {
        ...post,
        comments: allComments,
        stats: {
          commentCount: allComments.length,
          coownerCount: post.coowners.length,
          collectionCount: post.collections.length,
        },
        hasMedia: {
          hasImage: !!post.imageUrl,
          hasVideo: !!post.videoUrl,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("Failed to fetch post:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

export default postRouter;
