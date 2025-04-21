import { Router } from "express";
import { check, validationResult } from "express-validator";
import mongoose from "mongoose";
import { Income, Category } from "../databaseSchema/database.model.js";
import authMiddleware from "../Middleware/auth.js";

const router = Router();

// Input validation for adding income (regular and recurring)
const incomeValidation = [
  check("categoryId")
    .notEmpty()
    .withMessage("Category ID is required")
    .custom(async (value, { req }) => {
      const category = await Category.findOne({
        _id: value,
        userId: req.user.userId,
        type: "income",
      });
      if (!category) {
        throw new Error("Invalid income category");
      }
      return true;
    }),
  check("amount")
    .isFloat({ min: 0 })
    .withMessage("Amount must be a positive number"),
  check("paymentMethod")
    .isIn(["cash", "card", "bank", "mobile"])
    .withMessage("Invalid payment method"),
  check("date")
    .isDate()
    .withMessage("Valid date is required")
    .custom((value) => {
      if (new Date(value) > new Date()) {
        throw new Error("Future dates are not allowed");
      }
      return true;
    }),
];

// Validation for recurring income
const recurringIncomeValidation = [
  ...incomeValidation,
  check("isRecurring")
    .optional()
    .isBoolean()
    .withMessage("isRecurring must be a boolean"),
  check("frequency")
    .if((value, { req }) => req.body.isRecurring)
    .notEmpty()
    .withMessage("Frequency is required for recurring transactions")
    .isIn(["daily", "weekly", "monthly", "yearly"])
    .withMessage("Invalid frequency"),
  check("endDate")
    .optional()
    .isDate()
    .withMessage("Valid end date is required")
    .custom((value, { req }) => {
      if (value && new Date(value) <= new Date(req.body.date)) {
        throw new Error("End date must be after start date");
      }
      return true;
    }),
];

// Add a new or recurring income
router.post("/", authMiddleware, recurringIncomeValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { categoryId, amount, paymentMethod, date, notes, isRecurring, frequency, endDate } = req.body;

  try {
    const income = new Income({
      userId: req.user.userId,
      categoryId,
      amount,
      paymentMethod,
      date,
      notes,
      isRecurring: isRecurring || false,
      frequency: isRecurring ? frequency : null,
      nextOccurrence: isRecurring ? calculateNextOccurrence(date, frequency) : null,
      endDate: isRecurring && endDate ? endDate : null,
    });
    await income.save();
    res.status(201).json({ message: "Income added successfully", income });
  } catch (error) {
    console.error("Add Income Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Helper function to calculate next occurrence
function calculateNextOccurrence(date, frequency) {
  const currentDate = new Date(date);
  switch (frequency) {
    case "daily":
      return new Date(currentDate.setDate(currentDate.getDate() + 1));
    case "weekly":
      return new Date(currentDate.setDate(currentDate.getDate() + 7));
    case "monthly":
      return new Date(currentDate.setMonth(currentDate.getMonth() + 1));
    case "yearly":
      return new Date(currentDate.setFullYear(currentDate.getFullYear() + 1));
    default:
      return null;
  }
}

// Get user's incomes with optional date filters and pagination
router.get("/", authMiddleware, async (req, res) => {
  const { startDate, endDate, page = 1, limit = 10 } = req.query;
  const userId = new mongoose.Types.ObjectId(req.user.userId);
  const query = { userId };

  if (startDate && endDate) {
    query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  try {
    const incomes = await Income.find(query)
      .populate("categoryId", "name type")
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ date: -1 });
    const total = await Income.countDocuments(query);

    res.json({
      incomes,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Get Incomes Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get total income for dashboard
router.get("/total", authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const { startDate, endDate } = req.query;
    const query = { userId };
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    const total = await Income.aggregate([
      { $match: query },
      { $group: { _id: null, totalIncome: { $sum: "$amount" } } },
    ]);
    res.json({ totalIncome: total[0]?.totalIncome || 0 });
  } catch (error) {
    console.error("Get Total Income Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

export default router;