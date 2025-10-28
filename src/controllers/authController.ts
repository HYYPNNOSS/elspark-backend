import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { send } from "emailjs-com";
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import { Resend } from "resend";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET as string;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID!;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID!;
const EMAILJS_USER_ID = process.env.EMAILJS_USER_ID!;
const FRONTEND_URL = "elspark.online";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const MAX_PROFILES = 5;

const generateAccessToken = (account: { id: number; email: string }, profile: { id: number; username: string }) => {
  return jwt.sign(
    { accountId: account.id, profileId: profile.id, email: account.email, username: profile.username },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
};

const generateRefreshToken = async (accountId: number, profileId: number) => {
  const token = jwt.sign({ accountId, profileId }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  
  await prisma.accountRefreshToken.create({
    data: {
      token,
      accountId,
      profileId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  
  return token;
};

const resend = new Resend(process.env.RESEND_API_KEY);

export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Email is required" });

  const user = await prisma.account.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "15m" });
  
  await prisma.passwordResetToken.create({
    data: {
      token,
      accountId: user.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  const resetLink = `https://${FRONTEND_URL}/reset-password/${token}`;

  try {
    await resend.emails.send({
      from: 'Elspark <elcode.creator@gmail.com>', 
      to: email,
      subject: 'Reset your password',
      html: `
        <p>Hello dear elspark user,</p>
        <p>You requested to reset your password. Click the link below:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>This link will expire in 15 minutes.</p>
      `,
    });

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

    await prisma.account.update({
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
  const { email, username, password } = req.body;

  if (!email?.trim() || !username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "All fields required" });
  }

  try {
    // Check if email exists
    const emailExists = await prisma.account.findUnique({
      where: { email },
      select: { id: true },
    });

    if (emailExists) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // Check if username exists
    const usernameExists = await prisma.profile.findUnique({
      where: { username },
      select: { id: true },
    });

    if (usernameExists) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create account and first profile
    const account = await prisma.account.create({
      data: {
        email,
        password: hashedPassword,
        profiles: {
          create: {
            username,
            isActive: true,
          },
        },
      },
      include: {
        profiles: true,
      },
    });

    const profile = account.profiles[0];

    const accessToken = generateAccessToken(account, profile);
    const refreshToken = await generateRefreshToken(account.id, profile.id);

    return res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: profile.id,
        accountId: account.id,
        email: account.email,
        username: profile.username,
        profilePicture: profile.profilePicture,
        bio: profile.bio,
        cyberCoins: Number(account.cyberCoins),
      },
    });
  } catch (err: any) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const signin = async (req: Request, res: Response) => {
  const { email, password, profileId } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const account = await prisma.account.findUnique({
      where: { email },
      include: { profiles: true },
    });

    if (!account) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(password, account.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // If profileId provided, use that profile, otherwise use first profile or active one
    let selectedProfile = account.profiles.find(p => p.isActive);
    
    if (profileId) {
      selectedProfile = account.profiles.find(p => p.id === profileId);
    }
    
    if (!selectedProfile) {
      selectedProfile = account.profiles[0];
    }

    if (!selectedProfile) {
      return res.status(404).json({ error: "No profiles found" });
    }

    // Set this profile as active
    await prisma.profile.updateMany({
      where: { accountId: account.id },
      data: { isActive: false },
    });
    
    await prisma.profile.update({
      where: { id: selectedProfile.id },
      data: { isActive: true },
    });

    const accessToken = generateAccessToken(account, selectedProfile);
    const refreshToken = await generateRefreshToken(account.id, selectedProfile.id);

    return res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: selectedProfile.id,
        accountId: account.id,
        email: account.email,
        username: selectedProfile.username,
        profilePicture: selectedProfile.profilePicture,
        bio: selectedProfile.bio,
        cyberCoins: Number(account.cyberCoins),
      },
      profiles: account.profiles.map(p => ({
        id: p.id,
        username: p.username,
        profilePicture: p.profilePicture,
        isActive: p.id === selectedProfile.id,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const refreshAccessToken = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ error: "Refresh token required" });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as { accountId: number; profileId: number };

    const storedToken = await prisma.accountRefreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        account: {
          include: {
            profiles: {
              where: { id: decoded.profileId },
            },
          },
        },
      },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    const profile = storedToken.account.profiles[0];

    const newAccessToken = generateAccessToken(storedToken.account, profile);
    const newRefreshToken = await generateRefreshToken(storedToken.account.id, profile.id);

    await prisma.accountRefreshToken.delete({ where: { token: refreshToken } });

    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error("Refresh token error:", err);
    return res.status(401).json({ error: "Invalid refresh token" });
  }
};

export const createProfile = async (req: Request, res: Response) => {
  const { username } = req.body;
  const accountId = (req as any).user?.accountId; // From auth middleware

  if (!username?.trim()) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    // Check profile limit
    const profileCount = await prisma.profile.count({
      where: { accountId },
    });

    if (profileCount >= MAX_PROFILES) {
      return res.status(400).json({ error: `Maximum ${MAX_PROFILES} profiles allowed` });
    }

    // Check if username exists
    const usernameExists = await prisma.profile.findUnique({
      where: { username },
    });

    if (usernameExists) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    const newProfile = await prisma.profile.create({
      data: {
        accountId,
        username,
      },
    });

    return res.status(201).json({
      profile: {
        id: newProfile.id,
        username: newProfile.username,
        profilePicture: newProfile.profilePicture,
        bio: newProfile.bio,
        cyberCoins: Number(account?.cyberCoins),
      },
    });
  } catch (err: any) {
    console.error("Create profile error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const switchProfile = async (req: Request, res: Response) => {
  const { profileId } = req.body;
  const accountId = (req as any).user?.accountId;

  try {
    const profile = await prisma.profile.findFirst({
      where: {
        id: profileId,
        accountId,
      },
      include: {
        account: true,
      },
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Set all profiles to inactive
    await prisma.profile.updateMany({
      where: { accountId },
      data: { isActive: false },
    });

    // Set selected profile to active
    await prisma.profile.update({
      where: { id: profileId },
      data: { isActive: true },
    });

    const accessToken = generateAccessToken(profile.account, profile);
    const refreshToken = await generateRefreshToken(accountId, profileId);

    return res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: profile.id,
        accountId: profile.accountId,
        email: profile.account.email,
        username: profile.username,
        profilePicture: profile.profilePicture,
        bio: profile.bio,
        cyberCoins: Number(profile.account.cyberCoins),
      },
    });
  } catch (err) {
    console.error("Switch profile error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const getProfiles = async (req: Request, res: Response) => {
  const accountId = (req as any).user?.accountId;

  try {
    const profiles = await prisma.profile.findMany({
      where: { accountId },
      select: {
        id: true,
        username: true,
        profilePicture: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return res.status(200).json({ profiles, maxProfiles: MAX_PROFILES });
  } catch (err) {
    console.error("Get profiles error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};