import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { check, validationResult } from "express-validator";
import crypto from "crypto";
import nodemailer from "nodemailer";
import mongoose from "mongoose";
import { User, PasswordResetToken } from "../databaseSchema/database.model.js";
import authMiddleware from "../Middleware/auth.js";

const userController = Router();

// Input validation for registration
const registerValidation = [
  check("name").notEmpty().withMessage("Name is required"),
  check("email").isEmail().withMessage("Valid email is required"),
  check("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
];

// User Registration
userController.post("/register", registerValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, password } = req.body;

  try {
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();

    // Generate token
    const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: { id: newUser._id, name, email },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Input validation for login
const loginValidation = [
  check("email").isEmail().withMessage("Valid email is required"),
  check("password").notEmpty().withMessage("Password is required"),
];

// User Login
userController.post("/login", loginValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.json({
      message: "Login successful",
      token,
      user: { id: user._id, name: user.name, email },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Forgot password - Generate and send reset link
userController.post(
  "/forgot-password",
  [check("email").isEmail().withMessage("Valid email is required")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res
          .status(200)
          .json({ message: "If the email exists, a reset link has been sent" });
      }

      await PasswordResetToken.deleteMany({ userId: user._id });

      const resetToken = crypto.randomBytes(32).toString("hex");
      console.log("Raw Reset Token:", resetToken);
      const tokenHash = await bcrypt.hash(resetToken, 10);
      console.log("Hashed Token:", tokenHash);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await PasswordResetToken.create({
        userId: user._id,
        token: tokenHash,
        expiresAt,
      });

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const resetUrl = `bachatguru://reset-password/${resetToken}`;
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Bachat Guru Password Reset",
        text: `Click this link to reset your password: ${resetUrl}\nThis link expires in 1 hour.`,
      };

      await transporter.sendMail(mailOptions);

      res
        .status(200)
        .json({ message: "If the email exists, a reset link has been sent" });
    } catch (error) {
      console.error("Forgot Password Error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

// Reset Password
userController.post(
  "/reset-password/:token",
  [
    check("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token } = req.params;
    const { password } = req.body;

    try {
      const resetToken = await PasswordResetToken.findOne({
        expiresAt: { $gt: new Date() },
      }).populate("userId");

      console.log("Provided Token:", token);
      console.log("Stored Token Hash:", resetToken?.token);
      console.log("Token Exists and Not Expired:", !!resetToken);

      if (!resetToken || !resetToken.userId) {
        return res
          .status(400)
          .json({ message: "Invalid or expired reset token" });
      }

      const isValid = await bcrypt.compare(token, resetToken.token);
      console.log("Token Match:", isValid);

      if (!isValid) {
        return res
          .status(400)
          .json({ message: "Invalid or expired reset token" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await User.updateOne(
        { _id: resetToken.userId._id },
        { $set: { password: hashedPassword } }
      );

      await PasswordResetToken.deleteOne({ _id: resetToken._id });

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error("Reset Password Error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

// Get User Profile
userController.get("/user", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("name email");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ name: user.name, email: user.email });
  } catch (error) {
    console.error("Get User Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Input validation for changing password
const changePasswordValidation = [
  check("currentPassword")
    .notEmpty()
    .withMessage("Current password is required"),
  check("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long"),
  check("confirmPassword")
    .notEmpty()
    .withMessage("Confirm password is required"),
];

// Change password endpoint
userController.post(
  "/change-password",
  [authMiddleware, changePasswordValidation],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    try {
      // Find the user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Validate current password
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res
          .status(400)
          .json({ message: "Current password is incorrect" });
      }

      // Validate new password matches confirmation
      if (newPassword !== confirmPassword) {
        return res
          .status(400)
          .json({ message: "New password and confirmation do not match" });
      }

      // Hash the new password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);

      // Save the updated user
      await user.save();

      // Optionally: Invalidate the current token (force logout)
      // In a real app, you might want to store tokens in a database and invalidate them here.
      // For simplicity, we'll just return a success message and let the frontend handle logout.

      res.json({
        message: "Password changed successfully. Please log in again.",
      });
    } catch (error) {
      console.error("Change Password Error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

export default userController;
