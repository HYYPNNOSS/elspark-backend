"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWasabiUrl = exports.postMediaUpload = exports.profilePictureUpload = exports.s3Client = void 0;
// config/wasabi-config.ts
const client_s3_1 = require("@aws-sdk/client-s3");
const multer_1 = __importDefault(require("multer"));
const multer_s3_1 = __importDefault(require("multer-s3"));
const path_1 = __importDefault(require("path"));
const wasabiEndpoint = process.env.WASABI_ENDPOINT || "https://s3.eu-west-1.wasabisys.com";
const wasabiRegion = process.env.WASABI_REGION || "eu-west-1";
const wasabiBucket = process.env.WASABI_BUCKET_NAME || "elspark";
exports.s3Client = new client_s3_1.S3Client({
    endpoint: wasabiEndpoint,
    region: wasabiRegion,
    credentials: {
        accessKeyId: process.env.WASABI_ACCESS_KEY,
        secretAccessKey: process.env.WASABI_SECRET_KEY,
    },
    forcePathStyle: false, // Use virtual-hosted-style URLs
});
// Profile picture upload
exports.profilePictureUpload = (0, multer_1.default)({
    storage: (0, multer_s3_1.default)({
        s3: exports.s3Client,
        bucket: wasabiBucket,
        contentType: multer_s3_1.default.AUTO_CONTENT_TYPE,
        metadata: (req, file, cb) => {
            cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
            const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
            // Add 'elspark/' prefix
            const filename = `elspark/profiles/profile-${uniqueSuffix}${path_1.default.extname(file.originalname)}`;
            cb(null, filename);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        }
        else {
            cb(new Error("Only image files are allowed"));
        }
    },
});
// Post media upload (images and videos)
// config/wasabi-config.ts
exports.postMediaUpload = (0, multer_1.default)({
    storage: (0, multer_s3_1.default)({
        s3: exports.s3Client,
        bucket: wasabiBucket,
        contentType: multer_s3_1.default.AUTO_CONTENT_TYPE,
        metadata: (req, file, cb) => {
            cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
            const ext = path_1.default.extname(file.originalname);
            // Add 'elspark/' prefix to match your CDN structure
            const filename = `elspark/posts/${Date.now()}-${file.fieldname}${ext}`;
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
        }
        else {
            cb(new Error("Invalid file type"));
        }
    },
});
// Helper function to get public URL
const getWasabiUrl = (key) => {
    // Use virtual-hosted-style URL format for EU West 1 (London)
    return `https://${wasabiBucket}.s3.${wasabiRegion}.wasabisys.com/${key}`;
};
exports.getWasabiUrl = getWasabiUrl;
