import mongoose from "mongoose";

// User Model
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 255 },
    email: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
  },
  { timestamps: true }
);
export const User = mongoose.model("User", userSchema);

// Category Model
const categorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["income", "expense"], required: true },
  },
  { timestamps: true }
);
export const Category = mongoose.model("Category", categorySchema);

// Income Model
const incomeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    amount: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "bank", "mobile"],
      required: true,
    },
    date: { type: Date, required: true },
    notes: { type: String },
    isRecurring: { type: Boolean, default: false }, // New: Marks recurring transactions
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly"],
      default: null,
    }, // New: Recurrence frequency
    nextOccurrence: { type: Date, default: null }, // New: Next date to create transaction
    endDate: { type: Date, default: null }, // New: When recurrence stops (optional)
  },
  { timestamps: true }
);
export const Income = mongoose.model("Income", incomeSchema);

// Expense Model
const expenseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "bank", "mobile"],
      required: true,
    },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    notes: { type: String },
    isRecurring: { type: Boolean, default: false }, // New
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly"],
      default: null,
    }, // New
    nextOccurrence: { type: Date, default: null }, // New
    endDate: { type: Date, default: null }, // New
  },
  { timestamps: true }
);
export const Expense = mongoose.model("Expense", expenseSchema);

// Budget Model
const budgetSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    budgetName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    repeatable: {
      type: String,
      enum: ["none", "weekly", "monthly"],
      default: "none",
    },
  },
  { timestamps: true }
);
export const Budget = mongoose.model("Budget", budgetSchema);

const loanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    lenderName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    interestRate: { type: Number, required: true, min: 0, max: 100 },
    paymentAmount: { type: Number, required: true, min: 0 },
    paymentFrequency: {
      type: String,
      enum: ["monthly", "quarterly", "half-yearly"],
      required: true,
    },
    compoundingFrequency: {
      type: String,
      enum: ["monthly", "quarterly", "half-yearly"],
      required: true,
    },
    nextDueDate: { type: Date, required: true },
    amountPaid: { type: Number, default: 0, min: 0 },
    remainingBalance: { type: Number, required: true, min: 0 }, // Tracks principal
    numberOfPayments: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["active", "closed"], required: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);
export const Loan = mongoose.model("Loan", loanSchema);

// Notification Model
const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["budget_overrun", "loan_payment", "recurring_expense"],
      required: true,
    },
    message: { type: String, required: true },
    relatedId: { type: mongoose.Schema.Types.ObjectId, required: true },
    read: { type: Boolean, default: false },
    data: { type: Object }, // For dueDate
  },
  { timestamps: true }
);
export const Notification = mongoose.model("Notification", notificationSchema);

// Financial Goal Model
const financialGoalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  targetDate: { type: Date, required: true },
  notes: { type: String },
});
export const FinancialGoal = mongoose.model(
  "FinancialGoal",
  financialGoalSchema
);

// Recurring Transaction Model
const recurringTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    frequency: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly"],
      required: true,
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["cash", "card", "bank", "mobile"],
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);
export const RecurringTransaction = mongoose.model(
  "RecurringTransaction",
  recurringTransactionSchema
);

// Password Reset Schema
const passwordResetTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

export const PasswordResetToken = mongoose.model(
  "PasswordResetToken",
  passwordResetTokenSchema
);
