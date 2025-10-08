// config/wasabi-config.ts
import { S3Client } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import path from "path";

const wasabiEndpoint = process.env.WASABI_ENDPOINT || "https://s3.eu-west-1.wasabisys.com";
const wasabiRegion = process.env.WASABI_REGION || "eu-west-1";
const wasabiBucket = process.env.WASABI_BUCKET_NAME || "elspark";

export const s3Client = new S3Client({
  endpoint: wasabiEndpoint,
  region: wasabiRegion,
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY!,
    secretAccessKey: process.env.WASABI_SECRET_KEY!,
  },
  forcePathStyle: false, // Use virtual-hosted-style URLs
});

// Profile picture upload
export const profilePictureUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: wasabiBucket,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const filename = `profiles/profile-${uniqueSuffix}${path.extname(file.originalname)}`;
      cb(null, filename);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// Post media upload (images and videos)
export const postMediaUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: wasabiBucket,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const filename = `posts/${Date.now()}-${file.fieldname}${ext}`;
      cb(null, filename);
    },
  }),
  limits: { 
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "video/mp4", "video/webm", "video/quicktime",
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

// Helper function to get public URL
export const getWasabiUrl = (key: string): string => {
  // Use virtual-hosted-style URL format for EU West 1 (London)
  return `https://${wasabiBucket}.s3.${wasabiRegion}.wasabisys.com/${key}`;
};