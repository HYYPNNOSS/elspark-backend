import express, { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const ostrouter = express.Router()

const prisma = new PrismaClient()



ostrouter.get("/posts/public", async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const skip = (pageNum - 1) * limitNum;
  
      const publicPosts = await prisma.post.findMany({
        where: { isPrivate: false },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
        select: {
          id: true,
          text: true,
          imageUrl: true,
          videoUrl: true,
          createdAt: true,
          updatedAt: true,
          author: {
            select: { id: true, username: true, profilePicture: true },
          },
          coowners: {
            select: {
              user: {
                select: { id: true, username: true, profilePicture: true },
              },
            },
          },
          comments: {
            select: {
              id: true,
              content: true,
              createdAt: true,
              author: {
                select: { id: true, username: true, profilePicture: true },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 3,
          },
          _count: { select: { comments: true } },
        },
      });
  
      const totalCount = await prisma.post.count({ where: { isPrivate: false } });
      const totalPages = Math.ceil(totalCount / limitNum);
  
      res.json({
        posts: publicPosts,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          hasNextPage: pageNum < totalPages,
          hasPreviousPage: pageNum > 1,
        },
      });
    } catch (err) {
      console.error("Error fetching public posts:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  

export default ostrouter
