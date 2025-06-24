"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signin = exports.signup = exports.resetPassword = exports.forgotPassword = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const nodemailer_1 = __importDefault(require("nodemailer"));
const prisma = new client_1.PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_USER_ID = process.env.EMAILJS_USER_ID;
const FRONTEND_URL = "localhost:3000";
const forgotPassword = async (req, res) => {
    const { email } = req.body;
    if (!email)
        return res.status(400).json({ error: 'Email is required' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const token = jsonwebtoken_1.default.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '15m' });
    await prisma.passwordResetToken.create({
        data: {
            token,
            userId: user.id,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
    });
    const resetLink = `http:${FRONTEND_URL}/reset-password/${token}`;
    // Use Nodemailer to send the email
    const transporter = nodemailer_1.default.createTransport({
        service: 'gmail', // or use any SMTP provider
        auth: {
            user: process.env.EMAIL_USERNAME, // your Gmail or SMTP username
            pass: process.env.EMAIL_PASSWORD, // your app password or SMTP password
        },
    });
    const mailOptions = {
        from: process.env.EMAIL_USERNAME,
        to: email,
        subject: 'Reset your password',
        html: `
      <p>Hello ${user.username},</p>
      <p>You requested to reset your password. Click the link below:</p>
      <a href="${resetLink}">${resetLink}</a>
      <p>This link will expire in 15 minutes.</p>
    `,
    };
    try {
        await transporter.sendMail(mailOptions);
        return res.json({ message: 'Reset link sent to your email.' });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to send email' });
    }
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;
    if (!password)
        return res.status(400).json({ error: 'Password is required' });
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
        if (!resetToken || resetToken.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Token expired or invalid' });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 12);
        await prisma.user.update({
            where: { id: decoded.userId },
            data: { password: hashedPassword },
        });
        await prisma.passwordResetToken.delete({ where: { token } });
        return res.json({ message: 'Password updated successfully' });
    }
    catch (err) {
        console.error(err);
        return res.status(400).json({ error: 'Invalid or expired token' });
    }
};
exports.resetPassword = resetPassword;
const signup = async (req, res) => {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
        const existingUser = await prisma.user.findFirst({
            where: { OR: [{ email }, { username }] },
        });
        if (existingUser) {
            return res.status(400).json({ error: 'Email or username already exists' });
        }
        const hashedPassword = await bcrypt_1.default.hash(password, 12);
        const user = await prisma.user.create({
            data: {
                email,
                username,
                password: hashedPassword,
            },
        });
        const token = jsonwebtoken_1.default.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
        return res.status(201).json({
            token,
            user: { id: user.id, email: user.email, username: user.username },
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
};
exports.signup = signup;
const signin = async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const isPasswordValid = await bcrypt_1.default.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            email: user.email,
            username: user.username,
        }, JWT_SECRET, { expiresIn: '7d' });
        return res.status(200).json({
            token,
            user: { id: user.id, email: user.email, username: user.username },
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
};
exports.signin = signin;
