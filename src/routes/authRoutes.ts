import express, { Router } from "express";
import {
  signup,
  signin,
  forgotPassword,
  resetPassword,
  getProfiles,
  switchProfile,
  createProfile,
} from "../controllers/authController";
import { refreshAccessToken } from "../controllers/authController";
import { verifyToken } from "../middlewares/authMiddleware"; 



const router = Router();




router.post("/signup", signup as unknown as express.RequestHandler);
router.post("/signin", signin as unknown as express.RequestHandler);
router.post(
  "/forgot-password",
  forgotPassword as unknown as express.RequestHandler
);
router.post(
  "/reset-password/:token",
  resetPassword as unknown as express.RequestHandler
);
router.post("/refresh", refreshAccessToken as unknown as express.RequestHandler);
router.post("/create-profile", verifyToken, createProfile as unknown as express.RequestHandler);
router.post("/switch-profile", verifyToken, switchProfile as unknown as express.RequestHandler);
router.get("/profiles", verifyToken, getProfiles as unknown as express.RequestHandler);  


export default router;