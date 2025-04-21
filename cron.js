import cron from "node-cron";
import mongoose from "mongoose";
import { Expense, Notification } from "./databaseSchema/database.model.js";

// Run daily at midnight
cron.schedule("0 0 * * *", async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Process recurring expenses
    const recurringExpenses = await Expense.find({
      isRecurring: true,
      nextOccurrence: { $lte: tomorrow },
      $or: [{ endDate: null }, { endDate: { $gte: today } }],
    });

    for (const expense of recurringExpenses) {
      // Send notification (1-day reminder)
      const notificationDate = new Date(expense.nextOccurrence);
      notificationDate.setDate(notificationDate.getDate() - 1);
      if (notificationDate.toDateString() === today.toDateString()) {
        await Notification.create({
          userId: expense.userId,
          type: "recurring_expense",
          message: `Recurring expense via ${expense.paymentMethod} of $${expense.amount} due tomorrow`,
          relatedId: expense._id, // Add relatedId
        });
      }

      // Create new expense
      const newExpense = new Expense({
        userId: expense.userId,
        categoryId: expense.categoryId,
        paymentMethod: expense.paymentMethod,
        amount: expense.amount,
        date: expense.nextOccurrence,
        notes: expense.notes,
        isRecurring: true,
        frequency: expense.frequency,
        nextOccurrence: calculateNextOccurrence(expense.nextOccurrence, expense.frequency),
        endDate: expense.endDate,
      });
      await newExpense.save();

      // Update original expense
      expense.nextOccurrence = newExpense.nextOccurrence;
      await expense.save();
    }

    console.log("Recurring expenses processed");
  } catch (error) {
    console.error("Recurring Expense Cron Error:", error);
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

export default cron;