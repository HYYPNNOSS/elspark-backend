import express, { Router } from "express";
import {
  signup,
  signin,
  forgotPassword,
  resetPassword,
} from "../controllers/authController";
import { refreshAccessToken } from "../controllers/authController";


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


export default router;