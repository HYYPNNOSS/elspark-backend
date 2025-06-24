"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const FriendController_1 = require("../controllers/FriendController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
router.post("/request", authMiddleware_1.verifyToken, FriendController_1.sendRequest);
router.post("/accept", authMiddleware_1.verifyToken, FriendController_1.acceptRequest);
router.post("/decline", authMiddleware_1.verifyToken, FriendController_1.declineRequest);
router.get("/pending", authMiddleware_1.verifyToken, FriendController_1.getPendingRequests);
router.get("/list", authMiddleware_1.verifyToken, FriendController_1.getFriends);
exports.default = router;
