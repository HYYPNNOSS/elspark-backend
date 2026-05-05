"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET;
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    console.log(token);
    if (!token) {
        res.status(401).json({ error: "No token provided" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = {
            accountId: decoded.accountId,
            profileId: decoded.profileId || decoded.id,
            id: decoded.profileId || decoded.id
        };
        next();
    }
    catch (err) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
    }
};
exports.verifyToken = verifyToken;
exports.authenticate = exports.verifyToken;
