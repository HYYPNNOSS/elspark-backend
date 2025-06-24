"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// routes/comments.ts
const express_1 = __importDefault(require("express"));
const comments_1 = require("../controllers/comments");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Protect both routes with authentication
router.post('/', authMiddleware_1.verifyToken, comments_1.createComment);
router.get('/post/:postId', authMiddleware_1.verifyToken, comments_1.getPostComments);
exports.default = router;
