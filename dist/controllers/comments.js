"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPostComments = exports.createComment = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const createComment = async (req, res) => {
    try {
        const { content, postId, parentId } = req.body;
        const userId = req.user.id;
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
        if (postId && !parentId) {
            // Top-level comment on a post → notify post author
            const post = await prisma.post.findUnique({
                where: { id: postId },
                select: { authorId: true }
            });
            if (post && post.authorId !== userId) {
                await prisma.notification.create({
                    data: {
                        type: "comment",
                        message: `New comment on your post: "${comment.content}"`,
                        userId: post.authorId,
                        postId: postId.toString(),
                        commentId: comment.id.toString()
                    }
                });
            }
        }
        res.status(201).json(comment);
    }
    catch (error) {
        console.error('Error creating comment:', error);
        res.status(500).json({ error: 'Failed to create comment' });
    }
};
exports.createComment = createComment;
const getPostComments = async (req, res) => {
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
    }
    catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
};
exports.getPostComments = getPostComments;
