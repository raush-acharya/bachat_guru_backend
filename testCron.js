import mongoose from "mongoose";
import { Expense, Notification } from "./databaseSchema/database.model.js";

async function testCron() {
  try {
    await mongoose.connect("mongodb+srv://iims:iims123@raushdb.188ob.mongodb.net/bachat_guru?retryWrites=true&w=majority&appName=raushdb");
    console.log("Connected to MongoDB");

    const today = new Date("2025-04-11");
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    console.log("Today:", today, "Tomorrow:", tomorrow);

    const expense = await Expense.findOne({ _id: "67f8eda62e747313e8b9079f" });
    if (!expense) {
      console.log("Expense not found");
      return;
    }
    console.log("Found expense:", expense);

    // Send notification
    const notificationDate = new Date(expense.nextOccurrence);
    notificationDate.setDate(notificationDate.getDate() - 1);
    console.log("Notification date:", notificationDate, "Today:", today);
    if (notificationDate.toDateString() === today.toDateString()) {
      const notification = await Notification.create({
        userId: expense.userId,
        type: "recurring_expense",
        message: `Recurring expense via ${expense.paymentMethod} of $${expense.amount} due tomorrow`,
        relatedId: expense._id, // Add relatedId
      });
      console.log("Notification created:", notification);
    } else {
      console.log("Notification not created: date mismatch");
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
    console.log("New expense created:", newExpense);

    // Update original expense
    expense.nextOccurrence = newExpense.nextOccurrence;
    await expense.save();
    console.log("Original expense updated:", expense);

    console.log("Manual CRON simulation complete");
  } catch (error) {
    console.error("Manual CRON Error:", error);
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
}

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

testCron();