"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfiles = exports.switchProfile = exports.createProfile = exports.refreshAccessToken = exports.signin = exports.signup = exports.resetPassword = exports.forgotPassword = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const resend_1 = require("resend");
const prisma = new client_1.PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_USER_ID = process.env.EMAILJS_USER_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_WhrZ2UA4_CJsd7a8JmvqsYBFLdPqvdddV';
const FRONTEND_URL = process.env.FRONTEND_URL || "elspark.online";
const FROM_EMAIL = "noreply@elspark.online";
const resend = new resend_1.Resend(RESEND_API_KEY);
if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️ Using default RESEND_API_KEY. Set RESEND_API_KEY in environment variables for production.');
}
const ACCESS_TOKEN_EXPIRY = "14d";
const REFRESH_TOKEN_EXPIRY = "7d";
const MAX_PROFILES = 5;
const generateAccessToken = (account, profile) => {
    return jsonwebtoken_1.default.sign({ accountId: account.id, profileId: profile.id, email: account.email, username: profile.username }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
};
const generateRefreshToken = async (accountId, profileId) => {
    const token = jsonwebtoken_1.default.sign({ accountId, profileId }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
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
const forgotPassword = async (req, res) => {
    console.error('[FORGOT PASSWORD] Request received');
    console.error('[FORGOT PASSWORD] Body:', JSON.stringify(req.body));
    const { email } = req.body;
    if (!email) {
        console.error('[FORGOT PASSWORD] No email provided');
        return res.status(400).json({ error: "Email is required" });
    }
    console.error('[FORGOT PASSWORD] Email:', email);
    try {
        const user = await prisma.account.findUnique({ where: { email } });
        console.error('[FORGOT PASSWORD] User found:', !!user);
        if (!user) {
            console.error('[FORGOT PASSWORD] User not found in database');
            return res.status(404).json({ error: "User not found" });
        }
        console.error('[FORGOT PASSWORD] User ID:', user.id);
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "15m" });
        console.error('[FORGOT PASSWORD] JWT token generated');
        await prisma.passwordResetToken.create({
            data: {
                token,
                accountId: user.id,
                expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            },
        });
        console.error('[FORGOT PASSWORD] Reset token saved to DB');
        const resetLink = `https://${FRONTEND_URL}/reset-password/${token}`;
        console.error('[FORGOT PASSWORD] Reset link generated');
        console.error('[FORGOT PASSWORD] API Key configured:', RESEND_API_KEY.substring(0, 10) + '...');
        console.error('[FORGOT PASSWORD] Attempting to send email...');
        const { data, error } = await resend.emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: 'Reset your password - Elspark',
            html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>Hello dear Elspark user,</p>
          <p>You requested to reset your password. Click the button below:</p>
          <div style="margin: 30px 0;">
            <a href="${resetLink}" 
               style="background-color: #4F46E5; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>Or copy this link: <a href="${resetLink}">${resetLink}</a></p>
          <p style="color: #666; font-size: 14px;">This link will expire in 15 minutes.</p>
        </div>
      `,
        });
        if (error) {
            console.error('[FORGOT PASSWORD] ❌ Email sending failed');
            console.error('[FORGOT PASSWORD] Error:', JSON.stringify(error, null, 2));
            return res.status(500).json({
                error: "Failed to send email",
                details: error.message
            });
        }
        console.error('[FORGOT PASSWORD] ✅ Email sent successfully');
        console.error('[FORGOT PASSWORD] Email ID:', data?.id);
        console.error('[FORGOT PASSWORD] Response:', JSON.stringify(data, null, 2));
        return res.json({
            message: "Reset link sent to your email.",
            emailId: data?.id
        });
    }
    catch (err) {
        console.error('[FORGOT PASSWORD] ❌ ERROR:', err.name);
        console.error('[FORGOT PASSWORD] Message:', err.message);
        console.error('[FORGOT PASSWORD] Status:', err.statusCode);
        console.error('[FORGOT PASSWORD] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
        return res.status(500).json({
            error: "Failed to send email",
            details: err.message,
            statusCode: err.statusCode
        });
    }
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;
    if (!password)
        return res.status(400).json({ error: "Password is required" });
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const resetToken = await prisma.passwordResetToken.findUnique({
            where: { token },
        });
        if (!resetToken || resetToken.expiresAt < new Date()) {
            return res.status(400).json({ error: "Token expired or invalid" });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 12);
        await prisma.account.update({
            where: { id: decoded.userId },
            data: { password: hashedPassword },
        });
        await prisma.passwordResetToken.delete({ where: { token } });
        return res.json({ message: "Password updated successfully" });
    }
    catch (err) {
        console.error(err);
        return res.status(400).json({ error: "Invalid or expired token" });
    }
};
exports.resetPassword = resetPassword;
const signup = async (req, res) => {
    const { email, username, password } = req.body;
    if (!email?.trim() || !username?.trim() || !password?.trim()) {
        return res.status(400).json({ error: "All fields required" });
    }
    const existing = await prisma.account.findUnique({
        where: { email },
    });
    if (existing) {
        return res.status(409).json({ error: "User already exists" });
    }
    try {
        const emailExists = await prisma.account.findUnique({
            where: { email },
            select: { id: true },
        });
        if (emailExists) {
            return res.status(400).json({ error: "Email already exists" });
        }
        const usernameExists = await prisma.profile.findUnique({
            where: { username },
            select: { id: true },
        });
        if (usernameExists) {
            return res.status(400).json({ error: "Username already exists" });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
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
    }
    catch (err) {
        console.error("Signup error:", err);
        return res.status(500).json({ error: "Server error" });
    }
};
exports.signup = signup;
const signin = async (req, res) => {
    const { email, password, profileId } = req.body;
    // Validate input format
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
    }
    try {
        // Check if account exists
        const account = await prisma.account.findUnique({
            where: { email },
            include: { profiles: true },
        });
        if (!account) {
            return res.status(404).json({ error: "Email not found. Please sign up first." });
        }
        // Verify password
        const isPasswordValid = await bcrypt_1.default.compare(password, account.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: "Incorrect password. Please try again." });
        }
        // Select profile
        let selectedProfile = account.profiles.find(p => p.isActive);
        if (profileId) {
            selectedProfile = account.profiles.find(p => p.id === profileId);
        }
        if (!selectedProfile) {
            selectedProfile = account.profiles[0];
        }
        if (!selectedProfile) {
            return res.status(404).json({ error: "No profiles found for this account" });
        }
        // Update active profile
        await prisma.profile.updateMany({
            where: { accountId: account.id },
            data: { isActive: false },
        });
        await prisma.profile.update({
            where: { id: selectedProfile.id },
            data: { isActive: true },
        });
        // Generate tokens
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
    }
    catch (err) {
        console.error("Signin error:", err);
        return res.status(500).json({ error: "Server error. Please try again later." });
    }
};
exports.signin = signin;
const refreshAccessToken = async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        return res.status(401).json({ error: "Refresh token required" });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(refreshToken, JWT_SECRET);
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
    }
    catch (err) {
        console.error("Refresh token error:", err);
        return res.status(401).json({ error: "Invalid refresh token" });
    }
};
exports.refreshAccessToken = refreshAccessToken;
const createProfile = async (req, res) => {
    const { username } = req.body;
    const accountId = req.user?.accountId;
    if (!username?.trim()) {
        return res.status(400).json({ error: "Username is required" });
    }
    try {
        const profileCount = await prisma.profile.count({
            where: { accountId },
        });
        if (profileCount >= MAX_PROFILES) {
            return res.status(400).json({ error: `Maximum ${MAX_PROFILES} profiles allowed` });
        }
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
    }
    catch (err) {
        console.error("Create profile error:", err);
        return res.status(500).json({ error: "Server error" });
    }
};
exports.createProfile = createProfile;
const switchProfile = async (req, res) => {
    const { profileId } = req.body;
    const accountId = req.user?.accountId;
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
        await prisma.profile.updateMany({
            where: { accountId },
            data: { isActive: false },
        });
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
    }
    catch (err) {
        console.error("Switch profile error:", err);
        return res.status(500).json({ error: "Server error" });
    }
};
exports.switchProfile = switchProfile;
const getProfiles = async (req, res) => {
    const accountId = req.user?.accountId;
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
    }
    catch (err) {
        console.error("Get profiles error:", err);
        return res.status(500).json({ error: "Server error" });
    }
};
exports.getProfiles = getProfiles;
