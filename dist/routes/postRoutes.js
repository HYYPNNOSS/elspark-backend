"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// routes/postRouter.ts
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const authMiddleware_1 = require("../middlewares/authMiddleware");
const client_1 = require("@prisma/client");
const postRouter = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const storage = multer_1.default.diskStorage({
    destination: (_req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${Date.now()}-${file.fieldname}${ext}`);
    },
});
const upload = (0, multer_1.default)({ storage });
postRouter.post("/", authMiddleware_1.verifyToken, upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
]), async (req, res) => {
    const { text, isPrivate } = req.body;
    const user = req.user;
    if (!user?.id) {
        // const response = res.status(401).json({ error: "Unauthorized" });
        // return response;
    }
    try {
        const files = req.files;
        const imageFile = files?.["image"]?.[0];
        const videoFile = files?.["video"]?.[0];
        const imageUrl = imageFile ? `/uploads/${imageFile.filename}` : null;
        const videoUrl = videoFile ? `/uploads/${videoFile.filename}` : null;
        // console.log(!user?.id)
        const newPost = await prisma.post.create({
            data: {
                text,
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
    }
    catch (error) {
        console.error("Failed to create post:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
exports.default = postRouter;
