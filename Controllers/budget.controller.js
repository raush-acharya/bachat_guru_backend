import { Router } from "express";
import { check, validationResult } from "express-validator";
import mongoose from "mongoose";
import cron from "node-cron";
import authMiddleware from "../Middleware/auth.js";
import { Budget, Category, Expense, Notification } from "../databaseSchema/database.model.js";

const router = Router();

// Input validation for creating/updating a budget
const budgetValidation = [
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
  check("budgetName").notEmpty().withMessage("Budget name is required"),
  check("amount").isFloat({ min: 0 }).withMessage("Amount must be a positive number"),
  check("startDate").isDate().withMessage("Valid start date is required"),
  check("endDate")
    .isDate()
    .withMessage("Valid end date is required")
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startDate)) {
        throw new Error("End date must be after start date");
      }
      return true;
    }),
];

const budgetUpdateValidation = [
  check("budgetName").optional().notEmpty().withMessage("Budget name cannot be empty"),
  check("amount").optional().isFloat({ min: 0 }).withMessage("Amount must be a positive number"),
  check("startDate").optional().isDate().withMessage("Valid start date is required"),
  check("endDate")
    .optional()
    .isDate()
    .withMessage("Valid end date is required")
    .custom((value, { req }) => {
      if (req.body.startDate && new Date(value) <= new Date(req.body.startDate)) {
        throw new Error("End date must be after start date");
      }
      return true;
    }),
];

// Create a new budget
router.post("/", authMiddleware, budgetValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { categoryId, budgetName, amount, startDate, endDate, notes } = req.body;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    // Prevent overlapping budgets
    const existingBudget = await Budget.findOne({
      userId,
      categoryId,
      $or: [
        { startDate: { $lte: new Date(endDate) }, endDate: { $gte: new Date(startDate) } },
        { startDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
      ],
    });
    if (existingBudget) {
      return res.status(400).json({ message: "A budget already exists for this category and time period" });
    }

    const budget = new Budget({
      userId,
      categoryId,
      budgetName,
      amount,
      startDate,
      endDate,
      notes,
    });
    await budget.save();
    res.status(201).json({ message: "Budget created successfully", budget });
  } catch (error) {
    console.error("Create Budget Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get user's budgets with spending details
router.get("/", authMiddleware, async (req, res) => {
  const { startDate, endDate, categoryId } = req.query;
  const userId = new mongoose.Types.ObjectId(req.user.userId);
  const query = { userId };

  if (startDate || endDate) {
    query.startDate = {};
    if (startDate) {
      query.startDate.$gte = new Date(startDate);
    }
    if (endDate) {
      query.startDate.$lte = new Date(endDate);
    }
  }
  if (categoryId) {
    try {
      query.categoryId = new mongoose.Types.ObjectId(categoryId);
    } catch (error) {
      return res.status(400).json({ message: "Invalid category ID" });
    }
  }

  try {
    const budgets = await Budget.find(query)
      .populate("categoryId", "name type")
      .sort({ startDate: -1 });

    // Calculate spent amount for each budget
    const budgetsWithSpending = await Promise.all(
      budgets.map(async (budget) => {
        const expenseQuery = {
          userId,
          categoryId: budget.categoryId._id,
          date: { $gte: budget.startDate, $lte: budget.endDate },
        };
        const expenseResult = await Expense.aggregate([
          { $match: expenseQuery },
          { $group: { _id: null, spent: { $sum: "$amount" } } },
        ]);
        const spent = expenseResult[0]?.spent || 0;
        return {
          ...budget.toObject(),
          spent,
          remaining: budget.amount - spent,
          isOverBudget: spent > budget.amount,
        };
      })
    );

    res.json({ budgets: budgetsWithSpending });
  } catch (error) {
    console.error("Get Budgets Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a budget
router.put("/:id", authMiddleware, budgetUpdateValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { budgetName, amount, startDate, endDate, notes } = req.body;
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    let budget = await Budget.findOne({ _id: id, userId });

    if (!budget) {
      return res.status(404).json({ message: "Budget not found or not authorized" });
    }

    // Update fields if provided
    if (budgetName) budget.budgetName = budgetName;
    if (amount !== undefined) budget.amount = amount;
    if (startDate) budget.startDate = new Date(startDate);
    if (endDate) budget.endDate = new Date(endDate);
    if (notes !== undefined) budget.notes = notes;

    await budget.save();
    res.json({ message: "Budget updated successfully", budget });
  } catch (error) {
    console.error("Update Budget Error:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid budget ID" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a budget
router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const budget = await Budget.findOneAndDelete({ _id: id, userId });

    if (!budget) {
      return res.status(404).json({ message: "Budget not found or not authorized" });
    }

    res.json({ message: "Budget deleted successfully", budget });
  } catch (error) {
    console.error("Delete Budget Error:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid budget ID" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get total budget and spent for dashboard
router.get("/total", authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const { startDate, endDate } = req.query;
    const query = { userId };
    if (startDate && endDate) {
      query.startDate = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    const result = await Budget.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalBudget: { $sum: "$amount" },
        },
      },
    ]);
    const totalBudget = result[0]?.totalBudget || 0;
    const expenseResult = await Expense.aggregate([
      {
        $match: {
          userId,
          date: { $gte: new Date(startDate), $lte: new Date(endDate) },
        },
      },
      { $group: { _id: null, totalSpent: { $sum: "$amount" } } },
    ]);
    const totalSpent = expenseResult[0]?.totalSpent || 0;
    res.json({ totalBudget, totalSpent, totalRemaining: totalBudget - totalSpent });
  } catch (error) {
    console.error("Get Total Budget Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// CRON job for budget overrun notifications (runs daily at midnight)
cron.schedule("0 0 * * *", async () => {
  try {
    const budgets = await Budget.find({
      endDate: { $gte: new Date() },
    }).populate("categoryId");
    for (const budget of budgets) {
      const expenseQuery = {
        userId: budget.userId,
        categoryId: budget.categoryId._id,
        date: { $gte: budget.startDate, $lte: budget.endDate },
      };
      const expenseResult = await Expense.aggregate([
        { $match: expenseQuery },
        { $group: { _id: null, spent: { $sum: "$amount" } } },
      ]);
      const spent = expenseResult[0]?.spent || 0;
      if (spent > budget.amount) {
        await Notification.create({
          userId: budget.userId,
          type: "budget_overrun",
          message: `Budget "${budget.budgetName}" exceeded: Spent $${spent} of $${budget.amount}`,
        });
      }
    }
    console.log("Budget overrun notifications checked");
  } catch (error) {
    console.error("Budget Notification Cron Error:", error);
  }
});

export default router;