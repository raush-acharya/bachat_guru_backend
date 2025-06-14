import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import "./cron.js"; // At top, initializes CRON
import connectDB from "./db.connection.js";
import userController from "./Controllers/user.controller.js";
import loanController from "./Controllers/loan.controller.js";
import incomeController from "./Controllers/income.controller.js";
import expenseController from "./Controllers/expense.controller.js";
import categoryController from "./Controllers/category.controller.js";
import transactionsController from "./Controllers/transactions.controller.js";
import budgetController from "./Controllers/budget.controller.js";
import notificationsController from "./Controllers/notifications.controller.js";
import dashboardController from "./Controllers/dashboard.controller.js";

dotenv.config();

// backend app
const app = express();

// Middleware
app.use(cors({ origin: "http://localhost:19006" })); // Adjust for React Native
app.use(express.json());

// to make app understand json
app.use(express.json());

// register routes/controller
app.use("/api/auth", userController);
app.use("/api/loan", loanController);
app.use("/api/income", incomeController);
app.use("/api/expense", expenseController);
app.use("/api/category", categoryController);
app.use("/api/transactions", transactionsController);
app.use("/api/budget", budgetController);
app.use("/api/notifications", notificationsController);
app.use("/api/dashboard", dashboardController);

app.get("/health", (req, res) => {
  res.status(200).send("Server is healthy");
});

// Start server
const startServer = async () => {
  try {
    await connectDB();
    const PORT = process.env.PORT || 8000;
    app.listen(PORT, () => {
      console.log(`App is listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
