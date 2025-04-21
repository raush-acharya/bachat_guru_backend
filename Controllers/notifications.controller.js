import { Router } from "express";
import mongoose from "mongoose";
import authMiddleware from "../Middleware/auth.js";
import { Notification } from "../databaseSchema/database.model.js";

const router = Router();

// Get user's notifications
router.get("/", authMiddleware, async (req, res) => {
  const { read, type } = req.query;
  const userId = new mongoose.Types.ObjectId(req.user.userId);
  const query = { userId };

  if (read !== undefined) {
    query.read = read === "true";
  }
  if (type) {
    query.type = type;
  }

  try {
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50); // Limit to avoid overload
    res.json({ notifications });
  } catch (error) {
    console.error("Get Notifications Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark notification as read
router.put("/:id/read", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = new mongoose.Types.ObjectId(req.user.userId);

  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: "Notification not found or not authorized" });
    }

    res.json({ message: "Notification marked as read", notification });
  } catch (error) {
    console.error("Mark Notification Read Error:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid notification ID" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

export default router;