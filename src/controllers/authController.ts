import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { send } from "emailjs-com";
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET as string;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID!;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID!;
const EMAILJS_USER_ID = process.env.EMAILJS_USER_ID!;
const FRONTEND_URL = "localhost:3000";

export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Email is required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "15m" });

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  const resetLink = `http:${FRONTEND_URL}/reset-password/${token}`;

  // Use Nodemailer to send the email
  const transporter = nodemailer.createTransport({
    service: "gmail", // or use any SMTP provider
    auth: {
      user: process.env.EMAIL_USERNAME, // your Gmail or SMTP username
      pass: process.env.EMAIL_PASSWORD, // your app password or SMTP password
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: "Reset your password",
    html: `
      <p>Hello ${user.username},</p>
      <p>You requested to reset your password. Click the link below:</p>
      <a href="${resetLink}">${resetLink}</a>
      <p>This link will expire in 15 minutes.</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.json({ message: "Reset link sent to your email." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send email" });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password) return res.status(400).json({ error: "Password is required" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      return res.status(400).json({ error: "Token expired or invalid" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: decoded.userId },
      data: { password: hashedPassword },
    });

    await prisma.passwordResetToken.delete({ where: { token } });

    return res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: "Invalid or expired token" });
  }
};

export const signup = async (req: Request, res: Response) => {
  console.log("🚀 Signup started");
  const startTime = Date.now();
  
  const { email, username, password } = req.body;

  if (
    typeof email !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    email.trim() === "" ||
    username.trim() === "" ||
    password.trim() === ""
  ) {
    return res
      .status(400)
      .json({ error: "Invalid input: All fields required" });
  }

  try {
    console.log("⏰ Starting database checks...");
    const dbCheckStart = Date.now();
    
    const [emailExists, usernameExists] = await Promise.all([
      prisma.user.findUnique({
        where: { email },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { username },
        select: { id: true },
      }),
    ]);
    
    console.log(`✅ Database checks done in ${Date.now() - dbCheckStart}ms`);

    if (emailExists) {
      return res.status(400).json({ error: "Email already exists" });
    }

    if (usernameExists) {
      return res.status(400).json({ error: "Username already exists" });
    }

    console.log("🔐 Starting password hashing...");
    const hashStart = Date.now();
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log(`✅ Password hashed in ${Date.now() - hashStart}ms`);

    console.log("👤 Creating user...");
    const createStart = Date.now();
    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        username: true,
      },
    });
    console.log(`✅ User created in ${Date.now() - createStart}ms`);

    console.log("🎫 Creating token...");
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "7d" });

    const totalTime = Date.now() - startTime;
    console.log(`🏁 Total signup time: ${totalTime}ms`);

    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, username: user.username },
    });
  } catch (err: any) {
    console.error("❌ Signup error:", err);
    const totalTime = Date.now() - startTime;
    console.log(`💥 Failed after: ${totalTime}ms`);

    if (err.code === "P2002") {
      if (err.meta && err.meta.target && Array.isArray(err.meta.target)) {
        if (err.meta.target.includes("email")) {
          return res.status(400).json({ error: "Email already exists" });
        }
        if (err.meta.target.includes("username")) {
          return res.status(400).json({ error: "Username already exists" });
        }
      }
      return res.status(400).json({ error: "Email or username already exists" });
    }

    return res.status(500).json({ error: "Server error" });
  }
};

export const signin = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }
  console.log(email)
  console.log(password)

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    console.log(user)
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        username: user.username,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email, username: user.username },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};
