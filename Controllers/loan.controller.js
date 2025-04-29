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
  check("status")
    .isIn(["active", "closed"])
    .withMessage("Status must be active or closed"),
];

// Input validation for payment
const paymentValidation = [
  check("paymentAmount")
    .isFloat({ min: 0.01 })
    .withMessage("Payment amount must be greater than 0"),
  check("paymentDate")
    .optional()
    .isDate()
    .withMessage("Valid payment date is required if provided"),
];

const calculateNumberOfPayments = (startDate, endDate, paymentFrequency) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());

  switch (paymentFrequency) {
    case "monthly":
      return Math.max(1, months);
    case "quarterly":
      return Math.max(1, Math.floor(months / 3));
    case "half-yearly":
      return Math.max(1, Math.floor(months / 6));
    default:
      throw new Error("Invalid payment frequency");
  }
};

// Helper: Calculate amortization payment with correct handling of different compounding and payment frequencies
const calculatePayment = (
  principal,
  annualRate,
  compoundsPerYear,
  paymentsPerYear,
  numberOfPayments
) => {
  if (annualRate === 0) {
    return principal / numberOfPayments;
  }

  // Convert annual rate to periodic rate based on compounding frequency
  const ratePerCompoundPeriod = annualRate / 100 / compoundsPerYear;
  
  // Calculate effective annual rate with compounding
  const effectiveAnnualRate = Math.pow(1 + ratePerCompoundPeriod, compoundsPerYear) - 1;
  
  // Convert effective annual rate to payment period rate
  const ratePerPaymentPeriod = Math.pow(1 + effectiveAnnualRate, 1 / paymentsPerYear) - 1;
  
  // Use standard amortization formula
  return parseFloat(
    (principal * ratePerPaymentPeriod * Math.pow(1 + ratePerPaymentPeriod, numberOfPayments) / 
    (Math.pow(1 + ratePerPaymentPeriod, numberOfPayments) - 1)).toFixed(2)
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

// Helper: Safely advance date by months
const advanceDate = (date, months) => {
  const newDate = new Date(date);
  const currentMonth = newDate.getMonth();
  const currentDate = newDate.getDate();
  
  newDate.setMonth(currentMonth + months);
  
  if (newDate.getDate() !== currentDate) {
    newDate.setDate(0);
  }
  
  return newDate;
};

// Helper: Calculate interest accrued between two dates
const calculateAccruedInterest = (principal, annualRate, fromDate, toDate, compoundingFrequency) => {
  if (annualRate === 0) return 0;
  
  const from = new Date(fromDate);
  const to = new Date(toDate);
  
  if (to <= from) return 0;
  
  const { periodsPerYear } = getFrequencyDetails(compoundingFrequency);
  const ratePerPeriod = annualRate / 100 / periodsPerYear;
  
  // Calculate days between dates
  const daysDiff = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
  const periodsElapsed = daysDiff / (365 / periodsPerYear);
  
  // Compound interest formula: P * ((1 + r)^t - 1)
  const interest = principal * (Math.pow(1 + ratePerPeriod, periodsElapsed) - 1);
  
  return parseFloat(interest.toFixed(2));
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
    status,
    notes,
    paymentMethod = "bank",
  } = req.body;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end <= start) {
      return res.status(400).json({ message: "End date must be after start date" });
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount)) {
      return res.status(400).json({ message: "Invalid loan amount" });
    }

    const numberOfPayments = calculateNumberOfPayments(start, end, paymentFrequency);

    const { periodsPerYear: compoundsPerYear } = getFrequencyDetails(compoundingFrequency);
    const { periodsPerYear: paymentsPerYear } = getFrequencyDetails(paymentFrequency);

    const rawPaymentAmount = calculatePayment(
      parsedAmount,
      interestRate,
      compoundsPerYear,
      paymentsPerYear,
      numberOfPayments
    );

    const parsedPaymentAmount = Number(rawPaymentAmount);
    if (isNaN(parsedPaymentAmount)) {
      return res.status(500).json({ message: "Failed to calculate payment amount" });
    }

    let nextDueDate;
    if (paymentFrequency === "monthly") {
      nextDueDate = advanceDate(start, 1);
    } else if (paymentFrequency === "quarterly") {
      nextDueDate = advanceDate(start, 3);
    } else {
      nextDueDate = advanceDate(start, 6);
    }

    const loan = new Loan({
      userId,
      title,
      lenderName,
      amount: parseFloat(parsedAmount.toFixed(2)),
      startDate: start,
      endDate: end,
      interestRate,
      paymentAmount: parseFloat(parsedPaymentAmount.toFixed(2)),
      paymentFrequency,
      compoundingFrequency,
      nextDueDate,
      lastPaymentDate: start, // Track last payment date for interest calculations
      amountPaid: 0,
      remainingBalance: parseFloat(parsedAmount.toFixed(2)),
      numberOfPayments,
      status,
      notes,
      paymentMethod,
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
    status,
    notes,
    paymentMethod,
  } = req.body;
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    let loan = await Loan.findOne({ _id: id, userId });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or not authorized" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (end <= start) {
      return res.status(400).json({ message: "End date must be after start date" });
    }
    
    const numberOfPayments = calculateNumberOfPayments(start, end, paymentFrequency);

    const { periodsPerYear: compoundsPerYear } = getFrequencyDetails(compoundingFrequency);
    const { periodsPerYear: paymentsPerYear } = getFrequencyDetails(paymentFrequency);
    
    const paymentAmount = calculatePayment(
      amount,
      interestRate,
      compoundsPerYear,
      paymentsPerYear,
      numberOfPayments
    );

    // Calculate proper remaining balance considering interest accrual
    const now = new Date();
    const oldRemainingBalance = loan.remainingBalance;
    const oldAmount = loan.amount;
    const oldInterestRate = loan.interestRate;
    const oldCompoundingFreq = loan.compoundingFrequency;
    const lastPaymentDate = loan.lastPaymentDate || loan.startDate;
    
    // Calculate accrued interest since last payment
    const accruedInterest = calculateAccruedInterest(
      oldRemainingBalance,
      oldInterestRate,
      lastPaymentDate,
      now,
      oldCompoundingFreq
    );
    
    // Adjust the remaining balance based on the proportion paid plus accrued interest
    let newRemainingBalance;
    if (oldAmount !== amount && oldAmount > 0) {
      // Calculate what percentage of the original loan has been paid
      const principalPaid = oldAmount - (oldRemainingBalance - accruedInterest);
      const percentagePaid = principalPaid / oldAmount;
      
      // Apply same percentage to new loan amount
      newRemainingBalance = parseFloat((amount * (1 - percentagePaid)).toFixed(2));
    } else {
      newRemainingBalance = parseFloat(amount.toFixed(2));
    }

    // Recalculate next due date based on new settings
    let nextDueDate;
    if (paymentFrequency === "monthly") {
      nextDueDate = advanceDate(now, 1);
    } else if (paymentFrequency === "quarterly") {
      nextDueDate = advanceDate(now, 3);
    } else {
      nextDueDate = advanceDate(now, 6);
    }

    loan.title = title;
    loan.lenderName = lenderName;
    loan.amount = parseFloat(amount.toFixed(2));
    loan.startDate = start;
    loan.endDate = end;
    loan.interestRate = interestRate;
    loan.paymentAmount = parseFloat(paymentAmount.toFixed(2));
    loan.paymentFrequency = paymentFrequency;
    loan.compoundingFrequency = compoundingFrequency;
    loan.nextDueDate = nextDueDate;
    loan.numberOfPayments = numberOfPayments;
    loan.status = status;
    loan.notes = notes;
    if (paymentMethod) loan.paymentMethod = paymentMethod;
    
    loan.remainingBalance = newRemainingBalance;
    loan.amountPaid = parseFloat((amount - newRemainingBalance).toFixed(2));
    loan.lastPaymentDate = now; // Reset last payment date to now

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
      return res.status(404).json({ message: "Loan not found or not authorized" });
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
router.post("/:id/payment", [authMiddleware, paymentValidation], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { paymentAmount, paymentDate } = req.body;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    let loan = await Loan.findOne({ _id: id, userId });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or not authorized" });
    }

    if (loan.status === "closed") {
      return res.status(400).json({ message: "Loan is already closed" });
    }
    
    const paymentDateTime = paymentDate ? new Date(paymentDate) : new Date();
    const lastPaymentDate = loan.lastPaymentDate || loan.startDate;
    
    // Calculate accrued interest since last payment
    const accruedInterest = calculateAccruedInterest(
      loan.remainingBalance,
      loan.interestRate,
      lastPaymentDate,
      paymentDateTime,
      loan.compoundingFrequency
    );
    
    // Update remaining balance with accrued interest
    const currentBalance = parseFloat((loan.remainingBalance + accruedInterest).toFixed(2));
    
    const actualPaymentAmount = paymentAmount || loan.paymentAmount;
    
    if (actualPaymentAmount > currentBalance * 1.1) {
      return res.status(400).json({ 
        message: "Payment amount significantly exceeds remaining balance",
        suggestedPayment: parseFloat(currentBalance.toFixed(2))
      });
    }

    // Allocate payment to interest first, then principal
    const interestPaid = Math.min(accruedInterest, actualPaymentAmount);
    const principalPaid = parseFloat((actualPaymentAmount - interestPaid).toFixed(2));

    // Update loan records
    loan.amountPaid = parseFloat((loan.amountPaid + actualPaymentAmount).toFixed(2));
    loan.remainingBalance = Math.max(0, parseFloat((loan.remainingBalance - principalPaid).toFixed(2)));
    loan.lastPaymentDate = paymentDateTime;

    // Calculate next due date based on the current payment date, not the previous due date
    if (loan.paymentFrequency === "monthly") {
      loan.nextDueDate = advanceDate(paymentDateTime, 1);
    } else if (loan.paymentFrequency === "quarterly") {
      loan.nextDueDate = advanceDate(paymentDateTime, 3);
    } else {
      loan.nextDueDate = advanceDate(paymentDateTime, 6);
    }

    if (loan.remainingBalance <= 0.01) {
      loan.status = "closed";
      loan.remainingBalance = 0;
    }

    await loan.save();

    // Calculate total with correct compound interest
    const { periodsPerYear } = getFrequencyDetails(loan.compoundingFrequency);
    const ratePerPeriod = loan.interestRate / 100 / periodsPerYear;
    const totalPeriods = loan.numberOfPayments * periodsPerYear / getFrequencyDetails(loan.paymentFrequency).periodsPerYear;
    
    // Calculate total with compound interest: P(1+r)^n
    const totalWithInterest = parseFloat((loan.amount * Math.pow(1 + ratePerPeriod, totalPeriods)).toFixed(2));
    
    // Calculate expected remaining payments
    const paymentsRemaining = Math.max(0, Math.ceil(loan.remainingBalance / (loan.paymentAmount - (loan.remainingBalance * ratePerPeriod))));

    res.json({
      message: "Payment recorded successfully",
      loan,
      paymentDetails: {
        amount: actualPaymentAmount,
        interest: interestPaid,
        principalPaid: principalPaid,
        date: paymentDateTime,
      },
      paymentProgress: {
        originalAmount: loan.amount,
        totalWithInterest: totalWithInterest,
        amountPaid: loan.amountPaid,
        amountRemaining: Math.max(0, totalWithInterest - loan.amountPaid),
        remainingBalance: loan.remainingBalance,
        paymentsRemaining: paymentsRemaining,
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

// Early loan payoff endpoint
router.post("/:id/payoff", authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);
    let loan = await Loan.findOne({ _id: id, userId });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or not authorized" });
    }

    if (loan.status === "closed") {
      return res.status(400).json({ message: "Loan is already closed" });
    }

    const now = new Date();
    const lastPaymentDate = loan.lastPaymentDate || loan.startDate;
    
    // Calculate actual accrued interest since last payment
    const accruedInterest = calculateAccruedInterest(
      loan.remainingBalance,
      loan.interestRate,
      lastPaymentDate,
      now,
      loan.compoundingFrequency
    );
    
    const finalPaymentAmount = parseFloat((loan.remainingBalance + accruedInterest).toFixed(2));

    const previousAmountPaid = loan.amountPaid;
    loan.amountPaid = parseFloat((loan.amountPaid + finalPaymentAmount).toFixed(2));
    loan.remainingBalance = 0;
    loan.status = "closed";
    loan.nextDueDate = null;
    loan.lastPaymentDate = now;

    await loan.save();

    await Notification.deleteMany({
      userId,
      type: "loan_payment",
      relatedId: loan._id,
      read: false,
    });

    // Calculate what would have been paid if all regular payments were made
    const { periodsPerYear } = getFrequencyDetails(loan.compoundingFrequency);
    const totalPeriods = loan.numberOfPayments * periodsPerYear / getFrequencyDetails(loan.paymentFrequency).periodsPerYear;
    const totalWithFullTermInterest = parseFloat((loan.amount * Math.pow(1 + (loan.interestRate / 100 / periodsPerYear), totalPeriods)).toFixed(2));

    res.json({
      message: "Loan paid off successfully",
      loan,
      payoffDetails: {
        finalPayment: finalPaymentAmount,
        finalInterest: accruedInterest,
        totalPaid: loan.amountPaid,
        savings: parseFloat((totalWithFullTermInterest - loan.amountPaid).toFixed(2)),
      },
    });
  } catch (error) {
    console.error("Loan Payoff Error:", error);
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
    
    const upcomingWindow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    
    const overdueLoans = await Loan.find({
      status: "active",
      nextDueDate: { $lt: now },
    });

    for (const loan of overdueLoans) {
      const daysOverdue = Math.floor((now - loan.nextDueDate) / (24 * 60 * 60 * 1000));
      
      if (daysOverdue % 7 === 0) {
        const existingOverdueNotification = await Notification.findOne({
          userId: loan.userId,
          type: "loan_payment_overdue",
          relatedId: loan._id,
          read: false,
          "data.daysOverdue": daysOverdue,
        });

        if (!existingOverdueNotification) {
          const notification = new Notification({
            userId: loan.userId,
            type: "loan_payment_overdue",
            message: `OVERDUE: Your "${loan.title}" payment of $${loan.paymentAmount.toFixed(2)} was due on ${
              loan.nextDueDate.toISOString().split("T")[0]
            } (${daysOverdue} days overdue)`,
            relatedId: loan._id,
            data: { 
              dueDate: loan.nextDueDate.toISOString().split("T")[0],
              daysOverdue: daysOverdue 
            },
            read: false,
            priority: "high",
          });
          await notification.save();
        }
      }
    }

    const upcomingLoans = await Loan.find({
      status: "active",
      nextDueDate: { $gte: now, $lte: upcomingWindow },
    });

    for (const loan of upcomingLoans) {
      const existingUpcomingNotification = await Notification.findOne({
        userId: loan.userId,
        type: "loan_payment",
        relatedId: loan._id,
        read: false,
        "data.dueDate": loan.nextDueDate.toISOString().split("T")[0],
      });

      if (!existingUpcomingNotification) {
        const notification = new Notification({
          userId: loan.userId,
          type: "loan_payment",
          message: `Reminder: Your "${loan.title}" payment of $${loan.paymentAmount.toFixed(2)} is due on ${
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