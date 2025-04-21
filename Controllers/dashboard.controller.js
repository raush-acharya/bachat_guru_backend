import { Router } from "express";
import mongoose from "mongoose";
import authMiddleware from "../Middleware/auth.js";
import {
  Income,
  Expense,
  Budget,
  Loan,
  Notification,
  Category,
} from "../databaseSchema/database.model.js";

const router = Router();

// Get dashboard data
router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const { startDate, endDate } = req.query;
    const match = { userId };
    const today = new Date();
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const defaultEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const start = startDate ? new Date(startDate) : defaultStart;
    const end = endDate ? new Date(endDate) : defaultEnd;
    if (startDate && endDate) {
      match.date = { $gte: start, $lte: end };
    }

    // Parallel aggregations for income, expenses, loans, budgets, notifications
    const [
      incomeResult,
      expenseResult,
      loanResult,
      budgets,
      notifications,
      categories,
    ] = await Promise.all([
      // Total Income
      Income.aggregate([
        { $match: match },
        { $group: { _id: null, totalIncome: { $sum: "$amount" } } },
      ]),
      // Total Expenses and Spending Breakdown
      Expense.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$categoryId",
            totalSpent: { $sum: "$amount" },
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
            categoryId: "$_id",
            categoryName: "$category.name",
            totalSpent: 1,
          },
        },
      ]),
      // Total Loan Balance
      Loan.aggregate([
        { $match: { userId, status: "active" } },
        {
          $group: {
            _id: null,
            totalLoanBalance: { $sum: "$remainingBalance" },
          },
        },
      ]),
      // Budgets with Spending
      Budget.find(
        startDate && endDate
          ? {
              userId,
              startDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
            }
          : { userId }
      )
        .populate("categoryId", "name type")
        .sort({ startDate: -1 }),
      // Recent Notifications
      Notification.find({ userId }).sort({ createdAt: -1 }).limit(5),
      // All Categories for Reference
      Category.find({ userId, type: "expense" }).select("name"),
    ]);

    // Calculate budget spending
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

    // Recent Transactions (Income + Expense)
    const recentTransactions = await Promise.all([
      Income.find(match)
        .limit(5)
        .sort({ date: -1 })
        .populate("categoryId", "name type"),
      Expense.find(match)
        .limit(5)
        .sort({ date: -1 })
        .populate("categoryId", "name type"),
    ]).then(([incomes, expenses]) =>
      [...incomes, ...expenses]
        .sort((a, b) => b.date - a.date)
        .slice(0, 5)
        .map((tx) => ({
          _id: tx._id,
          type: tx.categoryId.type,
          categoryName: tx.categoryId.name,
          amount: tx.amount,
          date: tx.date,
          notes: tx.notes || "",
        }))
    );

    // Extract totals
    const totalIncome = incomeResult[0]?.totalIncome || 0;
    const totalExpenses = expenseResult.reduce(
      (sum, cat) => sum + cat.totalSpent,
      0
    );
    const totalLoanBalance = loanResult[0]?.totalLoanBalance || 0;

    const loanProgress = await Loan.aggregate([
        { $match: { userId, status: "active" } },
        {
          $group: {
            _id: null,
            totalPaid: { $sum: "$amountPaid" },
            totalOriginal: { $sum: "$amount" },
          },
        },
      ]);
      const totalPaid = loanProgress[0]?.totalPaid || 0;
      const totalOriginal = loanProgress[0]?.totalOriginal || 0;

    res.json({
      totalBalance: Number(
        (totalIncome - totalExpenses - totalLoanBalance).toFixed(2)
      ),
      totalIncome: Number(totalIncome.toFixed(2)),
      totalExpenses: Number(totalExpenses.toFixed(2)),
      totalLoanBalance: Number(totalLoanBalance.toFixed(2)),
      spendingBreakdown: expenseResult.map((cat) => ({
        ...cat,
        totalSpent: Number(cat.totalSpent.toFixed(2)),
      })),
      budgets: budgetsWithSpending,
      recentTransactions,
      notifications: notifications.map((n) => ({
        _id: n._id,
        type: n.type,
        message: n.message,
        createdAt: n.createdAt,
      })),
      loanProgress: {
        totalPaid: Number(totalPaid.toFixed(2)),
        totalOriginal: Number(totalOriginal.toFixed(2)),
        percentagePaid: totalOriginal ? Number(((totalPaid / totalOriginal) * 100).toFixed(2)) : 0,
      },
    });
  } catch (error) {
    console.error("Get Dashboard Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

export default router;
