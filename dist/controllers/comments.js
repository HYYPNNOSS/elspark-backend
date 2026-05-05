"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPostComments = exports.createComment = void 0;
const client_1 = require("@prisma/client");
const notificationsRoutes_1 = require("../routes/notificationsRoutes");
const prisma = new client_1.PrismaClient();
const createComment = async (req, res) => {
    try {
        const { content, postId, parentId } = req.body;
        const userId = req.user.id;
        if (!content || !content.trim()) {
            res.status(400).json({ error: 'Comment content is required' });
            return;
        }
        if (!postId && !parentId) {
            res.status(400).json({ error: 'Either postId or parentId is required' });
            return;
        }
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
        res.status(201).json(comment);
        (async () => {
            try {
                const commenter = await prisma.profile.findUnique({
                    where: { id: userId },
                    select: { username: true }
                });
                if (!commenter)
                    return;
                if (postId && !parentId) {
                    const post = await prisma.post.findUnique({
                        where: { id: postId },
                        select: { authorId: true }
                    });
                    if (post && post.authorId !== userId) {
                        await (0, notificationsRoutes_1.createNotification)('comment', `${commenter.username} commented on your post`, post.authorId, String(postId), String(comment.id), `/profile/post/${postId}`);
                    }
                }
                else if (parentId) {
                    const parentComment = await prisma.comment.findUnique({
                        where: { id: parentId },
                        select: { authorId: true, postId: true }
                    });
                    if (parentComment && parentComment.authorId !== userId) {
                        const actualPostId = parentComment.postId || postId;
                        if (actualPostId) {
                            await (0, notificationsRoutes_1.createNotification)('reply', `${commenter.username} replied to your comment`, parentComment.authorId, String(actualPostId), String(comment.id), `/profile/post/${actualPostId}`);
                        }
                    }
                }
            }
            catch (notificationError) {
                console.error('Failed to create notification:', notificationError);
            }
        })();
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
