import { Router } from "express";
import { check, validationResult } from "express-validator";
import mongoose from "mongoose";
import authMiddleware from "../Middleware/auth.js";
import { Expense, Category, Budget, Notification } from "../databaseSchema/database.model.js";

const router = Router();

// Input validation for expense (regular and recurring)
const expenseValidation = [
  check("categoryId")
    .notEmpty()
    .withMessage("Category ID is required")
    .custom(async (value, { req }) => {
      try {
        const category = await Category.findOne({
          _id: value,
          userId: req.user.userId,
          type: "expense",
        });
        if (!category) {
          throw new Error("Invalid expense category");
        }
        return true;
      } catch (error) {
        throw new Error("Invalid category ID");
      }
    }),
  check("amount").isFloat({ min: 0 }).withMessage("Amount must be a positive number"),
  check("paymentMethod")
    .notEmpty()
    .withMessage("Payment method is required")
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

// Create a new expense (regular or recurring)
router.post("/", authMiddleware, expenseValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { categoryId, amount, paymentMethod, date, notes, isRecurring, frequency, endDate } = req.body;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const expense = new Expense({
      userId,
      categoryId: new mongoose.Types.ObjectId(categoryId),
      amount,
      paymentMethod,
      date: new Date(date),
      notes,
      isRecurring: isRecurring || false,
      frequency: isRecurring ? frequency : null,
      nextOccurrence: isRecurring ? calculateNextOccurrence(date, frequency) : null,
      endDate: isRecurring && endDate ? new Date(endDate) : null,
    });
    await expense.save();

    // Check for budget overrun
    const budget = await Budget.findOne({
      userId,
      categoryId: new mongoose.Types.ObjectId(categoryId),
      startDate: { $lte: new Date(date) },
      endDate: { $gte: new Date(date) },
    }).populate("categoryId");

    if (budget) {
      const expenseQuery = {
        userId: new mongoose.Types.ObjectId(userId),
        categoryId: new mongoose.Types.ObjectId(categoryId),
        date: { $gte: new Date(budget.startDate), $lte: new Date(budget.endDate) },
      };
      const expenseResult = await Expense.aggregate([
        { $match: expenseQuery },
        { $group: { _id: null, spent: { $sum: "$amount" } } },
      ]);
      const spent = expenseResult[0]?.spent || 0;

      if (spent > budget.amount) {
        const existingNotification = await Notification.findOne({
          userId,
          type: "budget_overrun",
          relatedId: budget._id,
          read: false,
        });

        if (!existingNotification) {
          const notification = new Notification({
            userId,
            type: "budget_overrun",
            message: `Your "${budget.budgetName}" budget for ${budget.categoryId?.name || "Unknown"} has been exceeded (Spent: $${spent}, Budget: $${budget.amount})`,
            relatedId: budget._id,
          });
          await notification.save();
        }
      }
    }

    res.status(201).json({ message: "Expense added successfully", expense });
  } catch (error) {
    console.error("Create Expense Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update an expense
router.put("/:id", authMiddleware, expenseValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { categoryId, amount, paymentMethod, date, notes, isRecurring, frequency, endDate } = req.body;
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    let expense = await Expense.findOne({ _id: id, userId });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found or not authorized" });
    }

    // Update fields
    expense.categoryId = new mongoose.Types.ObjectId(categoryId);
    expense.amount = amount;
    expense.paymentMethod = paymentMethod;
    expense.date = new Date(date);
    expense.notes = notes;
    expense.isRecurring = isRecurring || false;
    expense.frequency = isRecurring ? frequency : null;
    expense.nextOccurrence = isRecurring ? calculateNextOccurrence(date, frequency) : null;
    expense.endDate = isRecurring && endDate ? new Date(endDate) : null;

    await expense.save();

    // Check for budget overrun
    const budget = await Budget.findOne({
      userId,
      categoryId: new mongoose.Types.ObjectId(categoryId),
      startDate: { $lte: new Date(date) },
      endDate: { $gte: new Date(date) },
    }).populate("categoryId");

    if (budget) {
      const expenseQuery = {
        userId: new mongoose.Types.ObjectId(userId),
        categoryId: new mongoose.Types.ObjectId(categoryId),
        date: { $gte: new Date(budget.startDate), $lte: new Date(budget.endDate) },
      };
      const expenseResult = await Expense.aggregate([
        { $match: expenseQuery },
        { $group: { _id: null, spent: { $sum: "$amount" } } },
      ]);
      const spent = expenseResult[0]?.spent || 0;

      if (spent > budget.amount) {
        const existingNotification = await Notification.findOne({
          userId,
          type: "budget_overrun",
          relatedId: budget._id,
          read: false,
        });

        if (!existingNotification) {
          const notification = new Notification({
            userId,
            type: "budget_overrun",
            message: `Your "${budget.budgetName}" budget for ${budget.categoryId?.name || "Unknown"} has been exceeded (Spent: $${spent}, Budget: $${budget.amount})`,
            relatedId: budget._id,
          });
          await notification.save();
        }
      } else {
        await Notification.deleteOne({
          userId,
          type: "budget_overrun",
          relatedId: budget._id,
          read: false,
        });
      }
    }

    res.json({ message: "Expense updated successfully", expense });
  } catch (error) {
    console.error("Update Expense Error:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid expense ID" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete an expense
router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const expense = await Expense.findOne({ _id: id, userId });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found or not authorized" });
    }

    // Check for budget overrun status after deletion
    const budget = await Budget.findOne({
      userId,
      categoryId: expense.categoryId,
      startDate: { $lte: new Date(expense.date) },
      endDate: { $gte: new Date(expense.date) },
    }).populate("categoryId");

    // Delete the expense
    await Expense.deleteOne({ _id: id, userId });

    if (budget) {
      const expenseQuery = {
        userId: new mongoose.Types.ObjectId(userId),
        categoryId: new mongoose.Types.ObjectId(expense.categoryId),
        date: { $gte: new Date(budget.startDate), $lte: new Date(budget.endDate) },
      };
      const expenseResult = await Expense.aggregate([
        { $match: expenseQuery },
        { $group: { _id: null, spent: { $sum: "$amount" } } },
      ]);
      const spent = expenseResult[0]?.spent || 0;

      if (spent <= budget.amount) {
        await Notification.deleteOne({
          userId,
          type: "budget_overrun",
          relatedId: budget._id,
          read: false,
        });
      }
    }

    res.json({ message: "Expense deleted successfully", expense });
  } catch (error) {
    console.error("Delete Expense Error:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid expense ID" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get user's expenses
router.get("/", authMiddleware, async (req, res) => {
  const { startDate, endDate, categoryId } = req.query;
  const userId = new mongoose.Types.ObjectId(req.user.userId);
  const query = { userId };

  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
  }
  if (categoryId) {
    try {
      query.categoryId = new mongoose.Types.ObjectId(categoryId);
    } catch (error) {
      return res.status(400).json({ message: "Invalid category ID" });
    }
  }

  try {
    const expenses = await Expense.find(query)
      .populate("categoryId", "name type")
      .sort({ date: -1 });
    res.json({ expenses });
  } catch (error) {
    console.error("Get Expenses Error:", error);
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

export default router;