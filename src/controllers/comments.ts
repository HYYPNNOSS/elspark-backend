import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client'
import { createNotification } from '../routes/notificationsRoutes';

const prisma = new PrismaClient()

export const createComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { content, postId, parentId } = req.body;
    const userId = (req as any).user.id;

    // Validate input
    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Comment content is required' });
      return;
    }

    if (!postId && !parentId) {
      res.status(400).json({ error: 'Either postId or parentId is required' });
      return;
    }

    // Ensure parent comment exists if replying
    if (parentId) {
      const parentExists = await prisma.comment.findUnique({
        where: { id: parentId }
      });
      if (!parentExists) {
        res.status(404).json({ error: 'Parent comment not found' });
        return;
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        postId: parentId ? null : postId,
        parentId: parentId || null,
        authorId: userId
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            profilePicture: true
          }
        },
        post: true,
        parent: true,
        replies: true
      }
    });

    // GET THE COMMENTER'S USERNAME
    const commenter = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true }
    });

    // ✅ TOP-LEVEL COMMENT - Only notify post author if they're NOT the commenter
    if (postId && !parentId) {
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { authorId: true }
      });

      // This condition already exists but make sure it's working
      if (post && post.authorId !== userId) {
        await createNotification(
          'comment',
          `${commenter?.username} commented on your post`,
          post.authorId, // Only notify the post author
          postId.toString(),
          comment.id.toString(),
          `/profile/post/${postId}`
        );
      }
    } 
    // ✅ REPLY TO COMMENT - Only notify parent comment author if they're NOT the commenter
    else if (parentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { authorId: true }
      });

      // This condition already exists but make sure it's working
      if (parentComment && parentComment.authorId !== userId) {
        await createNotification(
          'reply',
          `${commenter?.username} replied to your comment`,
          parentComment.authorId, // Only notify the parent comment author
          postId?.toString(),
          comment.id.toString(),
          `/profile/post/${postId}`
        );
      }
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
};

// Fixed getPostComments function - show all comments
export const getPostComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { postId } = req.params;

    const comments = await prisma.comment.findMany({
      where: {
        postId: Number(postId),
        // ✅ Removed authorId filter - shows all comments on the post
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            profilePicture: true
          }
        },
        replies: {
          include: {
            author: {
              select: {
                id: true,
                username: true,
                profilePicture: true
              }
            },
            replies: { 
              include: {
                author: {
                  select: {
                    id: true,
                    username: true,
                    profilePicture: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.status(200).json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
};
  