import express, { Router } from "express";
import {
  signup,
  signin,
  forgotPassword,
  resetPassword,
  mooshiSignup,
  importMoshis,
} from "../controllers/authController";

const router = Router();



router.post("/signup", signup as unknown as express.RequestHandler);
router.post("/signin", signin as unknown as express.RequestHandler);
router.post("/mooshi-signup", mooshiSignup as unknown as express.RequestHandler);
router.post(
  "/admin/import-moshis",
  importMoshis as unknown as express.RequestHandler
);

router.post(
  "/forgot-password",
  forgotPassword as unknown as express.RequestHandler
);
router.post(
  "/reset-password/:token",
  resetPassword as unknown as express.RequestHandler
);

export default router;