import { Router } from "express";
import { check, validationResult } from "express-validator";
import { Category } from "../databaseSchema/database.model.js";
import mongoose from "mongoose";
import authMiddleware from "../Middleware/auth.js";

const router = Router();

// Input validation for adding a category
const categoryValidation = [
  check("name").notEmpty().withMessage("Category name is required").trim(),
  check("type")
    .isIn(["income", "expense"])
    .withMessage("Type must be income or expense"),
];

// Add a new category
router.post("/", authMiddleware, categoryValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, type } = req.body;

  try {
    // Check if category already exists for user
    const existingCategory = await Category.findOne({
      userId: req.user.userId,
      name,
      type,
    });
    if (existingCategory) {
      return res.status(400).json({ message: "Category already exists" });
    }

    const category = new Category({
      userId: req.user.userId,
      name,
      type,
    });
    await category.save();
    res.status(201).json({ message: "Category added successfully", category });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get user's categories
router.get("/", authMiddleware, async (req, res) => {
  const { type } = req.query;
  const userId = new mongoose.Types.ObjectId(req.user.userId); // Convert to ObjectId
  const query = { userId };

  if (type) {
    query.type = type;
  }

  try {
    const categories = await Category.find(query).sort({ name: 1 });
    res.json({ categories });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

export default router;
