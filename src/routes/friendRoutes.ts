import express from "express";
import {
  sendRequest,
  acceptRequest,
  declineRequest,
  getPendingRequests,
  getFriends,
} from "../controllers/FriendController";
import { verifyToken } from "../middlewares/authMiddleware";

const router = express.Router();

router.post("/request", verifyToken, sendRequest);
router.post("/accept", verifyToken, acceptRequest);
router.post("/decline", verifyToken, declineRequest);
router.get("/pending", verifyToken, getPendingRequests);
router.get("/list", verifyToken, getFriends);

export default router;