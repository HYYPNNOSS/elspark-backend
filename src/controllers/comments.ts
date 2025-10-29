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
      const commenter = await prisma.profile.findUnique({
        where: { id: userId },
        select: { username: true }
      });
  
      if (postId && !parentId) {
        // Top-level comment on a post → notify post author
        const post = await prisma.post.findUnique({
          where: { id: postId },
          select: { authorId: true }
        });
  
        if (post && post.authorId !== userId) {
          await createNotification(
            'comment',
            `${commenter?.username} commented on your post`,
            post.authorId,
            postId.toString(), // ✅ Convert to string
            comment.id.toString(), // ✅ Convert to string
            `/profile/post/${postId}`
          );
        }
      } else if (parentId) {
        // Reply to a comment → notify parent comment author
        const parentComment = await prisma.comment.findUnique({
          where: { id: parentId },
          select: { authorId: true, postId: true } // ✅ Also get postId from parent
        });
  
        if (parentComment && parentComment.authorId !== userId) {
          // ✅ Use parentComment.postId instead of the potentially null postId parameter
          const actualPostId = parentComment.postId || postId;
          
          await createNotification(
            'reply',
            `${commenter?.username} replied to your comment`,
            parentComment.authorId, 
            actualPostId ? actualPostId.toString() : undefined, // ✅ Safe conversion
            comment.id.toString(),
            actualPostId ? `/profile/post/${actualPostId}` : undefined
          );
        }
      }
  
      res.status(201).json(comment);
    } catch (error) {
      console.error('Error creating comment:', error);
      res.status(500).json({ error: 'Failed to create comment' });
    }
  };
  
  export const getPostComments = async (req: Request, res: Response): Promise<void> => {
    try {
      const { postId } = req.params;
  
      const comments = await prisma.comment.findMany({
        where: {
          postId: Number(postId),
          parentId: null
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