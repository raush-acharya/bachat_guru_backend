import { Router } from "express";
import { check, validationResult } from "express-validator";
import mongoose from "mongoose";
import cron from "node-cron";
import authMiddleware from "../Middleware/auth.js";
import { Loan, Notification } from "../databaseSchema/database.model.js";

const router = Router();

// Input validation for adding/updating a loan
const loanValidation = [
  check("title").notEmpty().withMessage("Loan title is required"),
  check("lenderName").notEmpty().withMessage("Lender name is required"),
  check("amount")
    .isFloat({ min: 0 })
    .withMessage("Amount must be a positive number"),
  check("startDate").isDate().withMessage("Valid start date is required"),
  check("endDate").isDate().withMessage("Valid end date is required"),
  check("interestRate")
    .isFloat({ min: 0, max: 100 })
    .withMessage("Interest rate must be between 0 and 100"),
  check("paymentFrequency")
    .isIn(["monthly", "quarterly", "half-yearly"])
    .withMessage(
      "Payment frequency must be monthly, quarterly, or half-yearly"
    ),
  check("compoundingFrequency")
    .isIn(["monthly", "quarterly", "half-yearly"])
    .withMessage(
      "Compounding frequency must be monthly, quarterly, or half-yearly"
    ),
  check("numberOfPayments")
    .isInt({ min: 1 })
    .withMessage("Number of payments must be at least 1"),
  check("status")
    .isIn(["active", "closed"])
    .withMessage("Status must be active or closed"),
];

// Helper: Calculate amortization payment
const calculatePayment = (
  principal,
  annualRate,
  compoundsPerYear,
  paymentsPerYear,
  numberOfPayments
) => {
  const ratePerPeriod = annualRate / 100 / compoundsPerYear;
  const effectivePayments =
    numberOfPayments * (compoundsPerYear / paymentsPerYear);
  return (
    (principal * ratePerPeriod) /
    (1 - Math.pow(1 + ratePerPeriod, -effectivePayments))
  );
};

// Helper: Get compounds/payments per year
const getFrequencyDetails = (frequency) => {
  switch (frequency) {
    case "monthly":
      return { periodsPerYear: 12, daysPerPeriod: 30 };
    case "quarterly":
      return { periodsPerYear: 4, daysPerPeriod: 90 };
    case "half-yearly":
      return { periodsPerYear: 2, daysPerPeriod: 180 };
    default:
      throw new Error("Invalid frequency");
  }
};

// Add a new loan
router.post("/", authMiddleware, loanValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    title,
    lenderName,
    amount,
    startDate,
    endDate,
    interestRate,
    paymentFrequency,
    compoundingFrequency,
    numberOfPayments,
    status,
    notes,
  } = req.body;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Calculate payment amount
    const { periodsPerYear: compoundsPerYear } =
      getFrequencyDetails(compoundingFrequency);
    const { periodsPerYear: paymentsPerYear } =
      getFrequencyDetails(paymentFrequency);
    const paymentAmount = calculatePayment(
      amount,
      interestRate,
      compoundsPerYear,
      paymentsPerYear,
      numberOfPayments
    );

    // Set first due date
    let nextDueDate = new Date(start);
    if (paymentFrequency === "monthly") {
      nextDueDate.setMonth(start.getMonth() + 1);
    } else if (paymentFrequency === "quarterly") {
      nextDueDate.setMonth(start.getMonth() + 3);
    } else {
      nextDueDate.setMonth(start.getMonth() + 6);
    }

    const loan = new Loan({
      userId,
      title,
      lenderName,
      amount,
      startDate: start,
      endDate: end,
      interestRate,
      paymentAmount,
      paymentFrequency,
      compoundingFrequency,
      nextDueDate,
      amountPaid: 0,
      remainingBalance: amount,
      numberOfPayments,
      status,
      notes,
    });
    await loan.save();

    res.status(201).json({ message: "Loan added successfully", loan });
  } catch (error) {
    console.error("Create Loan Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get user's loans
router.get("/", authMiddleware, async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const userId = new mongoose.Types.ObjectId(req.user.userId);
  const query = { userId };

  if (status) {
    query.status = status;
  }

  try {
    const loans = await Loan.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ startDate: -1 });
    const total = await Loan.countDocuments(query);

    res.json({
      loans,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Get Loans Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a loan
router.put("/:id", authMiddleware, loanValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    title,
    lenderName,
    amount,
    startDate,
    endDate,
    interestRate,
    paymentFrequency,
    compoundingFrequency,
    numberOfPayments,
    status,
    notes,
  } = req.body;
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    let loan = await Loan.findOne({ _id: id, userId });

    if (!loan) {
      return res
        .status(404)
        .json({ message: "Loan not found or not authorized" });
    }

    // Recalculate payment amount
    const { periodsPerYear: compoundsPerYear } =
      getFrequencyDetails(compoundingFrequency);
    const { periodsPerYear: paymentsPerYear } =
      getFrequencyDetails(paymentFrequency);
    const paymentAmount = calculatePayment(
      amount,
      interestRate,
      compoundsPerYear,
      paymentsPerYear,
      numberOfPayments
    );

    // Update nextDueDate
    const start = new Date(startDate);
    let nextDueDate = new Date(start);
    if (paymentFrequency === "monthly") {
      nextDueDate.setMonth(start.getMonth() + 1);
    } else if (paymentFrequency === "quarterly") {
      nextDueDate.setMonth(start.getMonth() + 3);
    } else {
      nextDueDate.setMonth(start.getMonth() + 6);
    }

    loan.title = title;
    loan.lenderName = lenderName;
    loan.amount = amount;
    loan.startDate = start;
    loan.endDate = new Date(endDate);
    loan.interestRate = interestRate;
    loan.paymentAmount = paymentAmount;
    loan.paymentFrequency = paymentFrequency;
    loan.compoundingFrequency = compoundingFrequency;
    loan.nextDueDate = nextDueDate;
    loan.numberOfPayments = numberOfPayments;
    loan.status = status;
    loan.notes = notes;
    loan.remainingBalance = amount; // Reset balance (assumes no payments yet)

    await loan.save();

    res.json({ message: "Loan updated successfully", loan });
  } catch (error) {
    console.error("Update Loan Error:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid loan ID" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a loan
router.delete("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const loan = await Loan.findOne({ _id: id, userId });

    if (!loan) {
      return res
        .status(404)
        .json({ message: "Loan not found or not authorized" });
    }

    await Loan.deleteOne({ _id: id, userId });
    await Notification.deleteMany({
      userId,
      type: "loan_payment",
      relatedId: loan._id,
    });

    res.json({ message: "Loan deleted successfully", loan });
  } catch (error) {
    console.error("Delete Loan Error:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid loan ID" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Record a loan payment
router.post("/:id/payment", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    let loan = await Loan.findOne({ _id: id, userId });

    if (!loan) {
      return res
        .status(404)
        .json({ message: "Loan not found or not authorized" });
    }

    if (loan.status === "closed") {
      return res.status(400).json({ message: "Loan is already closed" });
    }

    // Calculate interest for the period
    const { periodsPerYear: compoundsPerYear } = getFrequencyDetails(
      loan.compoundingFrequency
    );
    const interestRatePerPeriod = loan.interestRate / 100 / compoundsPerYear;
    const interest = loan.remainingBalance * interestRatePerPeriod;
    const principalPaid = loan.paymentAmount - interest;

    // Update loan
    loan.amountPaid += loan.paymentAmount;
    loan.remainingBalance -= principalPaid;

    // Update nextDueDate
    const currentDueDate = new Date(loan.nextDueDate);
    if (loan.paymentFrequency === "monthly") {
      currentDueDate.setMonth(currentDueDate.getMonth() + 1);
    } else if (loan.paymentFrequency === "quarterly") {
      currentDueDate.setMonth(currentDueDate.getMonth() + 3);
    } else {
      currentDueDate.setMonth(currentDueDate.getMonth() + 6);
    }
    loan.nextDueDate = currentDueDate;

    // Check if loan is paid off
    if (loan.remainingBalance <= 0.01) {
      // Small threshold for rounding
      loan.status = "closed";
      loan.remainingBalance = 0;
    }

    await loan.save();

    // Calculate total with interest (approximate)
    const totalWithInterest = loan.paymentAmount * loan.numberOfPayments;

    res.json({
      message: "Payment recorded successfully",
      loan,
      paymentProgress: {
        originalAmount: loan.amount,
        totalWithInterest: totalWithInterest.toFixed(2),
        amountPaid: loan.amountPaid.toFixed(2),
        amountRemaining: Math.max(
          0,
          totalWithInterest - loan.amountPaid
        ).toFixed(2),
        remainingBalance: loan.remainingBalance.toFixed(2),
        paymentsMade: Math.round(loan.amountPaid / loan.paymentAmount),
        paymentsRemaining:
          loan.numberOfPayments -
          Math.round(loan.amountPaid / loan.paymentAmount),
      },
    });
  } catch (error) {
    console.error("Record Payment Error:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid loan ID" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Schedule loan payment reminders
cron.schedule("0 0 * * *", async () => {
  try {
    const now = new Date();
    const reminderWindow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const loans = await Loan.find({
      status: "active",
      nextDueDate: { $gte: now, $lte: reminderWindow },
    });

    for (const loan of loans) {
      const existingNotification = await Notification.findOne({
        userId: loan.userId,
        type: "loan_payment",
        relatedId: loan._id,
        read: false,
        "data.dueDate": loan.nextDueDate.toISOString().split("T")[0],
      });

      if (!existingNotification) {
        const notification = new Notification({
          userId: loan.userId,
          type: "loan_payment",
          message: `Reminder: Your "${
            loan.title
          }" payment of $${loan.paymentAmount.toFixed(2)} is due on ${
            loan.nextDueDate.toISOString().split("T")[0]
          }`,
          relatedId: loan._id,
          data: { dueDate: loan.nextDueDate.toISOString().split("T")[0] },
          read: false,
        });
        await notification.save();
      }
    }
  } catch (error) {
    console.error("Loan Notification Cron Error:", error);
  }
});

export default router;
