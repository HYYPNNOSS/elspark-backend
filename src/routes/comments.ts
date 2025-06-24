// routes/comments.ts
import express from 'express';
import { createComment, getPostComments  } from '../controllers/comments';
import { verifyToken } from '../middlewares/authMiddleware'; 


const router = express.Router();

// Protect both routes with authentication
router.post('/', verifyToken, createComment);
router.get('/post/:postId', verifyToken, getPostComments);

export default router;