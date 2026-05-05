"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const ostrouter = express_1.default.Router();
const prisma = new client_1.PrismaClient();
ostrouter.get("/posts/public", async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        const publicPosts = await prisma.post.findMany({
            where: { isPrivate: false },
            orderBy: { createdAt: "desc" },
            skip,
            take: limitNum,
            select: {
                id: true,
                title: true,
                text: true,
                isAnonymous: true,
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
    }
    catch (err) {
        console.error("Error fetching public posts:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = ostrouter;
