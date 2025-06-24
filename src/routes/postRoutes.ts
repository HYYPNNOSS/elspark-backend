// routes/postRouter.ts
import express from "express";
import multer from "multer";
import path from "path";
import { verifyToken } from "../middlewares/authMiddleware";
import { PrismaClient } from "@prisma/client";

const postRouter = express.Router();
const prisma = new PrismaClient();

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  },
});

const upload = multer({ storage });

postRouter.post(
  "/",
  verifyToken,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  async (req: express.Request, res: express.Response) => {
    const { text, isPrivate } = req.body;
    const user = (req as any).user;

    if (!user?.id) {
      // const response = res.status(401).json({ error: "Unauthorized" });
      // return response;
    }

    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
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
    } catch (error) {
      console.error("Failed to create post:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

export default postRouter;
