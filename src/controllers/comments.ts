import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client'

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
          postId: parentId ? null : postId, // Only set postId for top-level
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
  