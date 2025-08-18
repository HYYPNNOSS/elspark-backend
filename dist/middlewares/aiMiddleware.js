"use strict";
// import { Request, Response, NextFunction } from "express";
// import jwt from "jsonwebtoken";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const aiMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        // Debug logging to see what's in the token
        console.log("Decoded JWT payload:", decoded);
        // Handle both 'id' and 'userId' fields in JWT payload
        const userId = decoded.userId || decoded.id;
        if (!userId) {
            console.log("No userId or id found in JWT payload");
            res.status(401).json({ error: "Invalid token: missing user ID" });
            return;
        }
        req.user = {
            userId: userId,
            email: decoded.email
        };
        console.log("Set req.user:", req.user);
        next();
    }
    catch (err) {
        console.error("JWT verification error:", err);
        res.status(403).json({ error: "Token invalid or expired" });
    }
};
exports.aiMiddleware = aiMiddleware;
