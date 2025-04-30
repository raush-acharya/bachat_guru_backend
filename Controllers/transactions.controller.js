import { Router } from "express";
import mongoose from "mongoose";
import authMiddleware from "../Middleware/auth.js";
import { Income, Expense, Category } from "../databaseSchema/database.model.js";

const router = Router();

router.get("/", authMiddleware, async (req, res) => {
  const { startDate, endDate, categoryId, paymentMethod } = req.query;
  let userId;

  // Validate and convert userId to ObjectId
  try {
    userId = new mongoose.Types.ObjectId(req.user.userId);
  } catch (error) {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  const query = { userId };

  // Apply filters
  if (startDate || endDate) {
    query.date = {};
    if (startDate) {
      query.date.$gte = new Date(startDate);
    }
    if (endDate) {
      query.date.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }
  }
  if (categoryId) {
    try {
      query.categoryId = new mongoose.Types.ObjectId(categoryId);
    } catch (error) {
      return res.status(400).json({ message: "Invalid category ID" });
    }
  }
  if (paymentMethod) {
    query.paymentMethod = paymentMethod;
  }

  try {
    // Count documents
    const incomeCount = await Income.countDocuments(query);
    const expenseCount = await Expense.countDocuments(query);

    // Aggregate total income
    const incomeResult = await Income.aggregate([
      { $match: query },
      { $group: { _id: null, totalIncome: { $sum: "$amount" } } },
    ]);
    const totalIncome = incomeResult[0]?.totalIncome || 0;

    // Aggregate total expenses
    const expenseResult = await Expense.aggregate([
      { $match: query },
      { $group: { _id: null, totalExpenses: { $sum: "$amount" } } },
    ]);
    const totalExpenses = expenseResult[0]?.totalExpenses || 0;

    // Fetch incomes with populated category and notes
    const incomes = await Income.find(query)
      .populate("categoryId", "name type")
      .select("amount date notes paymentMethod categoryId");

    // Fetch expenses with populated category and notes
    const expenses = await Expense.find(query)
      .populate("categoryId", "name type")
      .select("amount date notes paymentMethod categoryId");

    // Aggregate by category for breakdown
    const incomeByCategory = await Income.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$categoryId",
          total: { $sum: "$amount" },
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: "$category" },
      {
        $project: {
          categoryName: "$category.name",
          categoryType: "$category.type",
          total: 1,
        },
      },
    ]);

    const expensesByCategory = await Expense.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$categoryId",
          total: { $sum: "$amount" },
        },
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: "$category" },
      {
        $project: {
          categoryName: "$category.name",
          categoryType: "$category.type",
          total: 1,
        },
      },
    ]);

    const netMoney = totalIncome - totalExpenses;

    res.json({
      totalIncome,
      totalExpenses,
      netMoney,
      incomeCount,
      expenseCount,
      incomes, // Include incomes with notes
      expenses, // Include expenses with notes
      incomeByCategory,
      expensesByCategory,
    });
  } catch (error) {
    console.error("Aggregation Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

export default router;