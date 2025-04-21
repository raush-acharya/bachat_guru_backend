import mongoose from "mongoose";

import * as dotenv from "dotenv";
dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.URI);

    mongoose.connection.once("open", async () => {
      await mongoose.connection.db
        .collection("incomes")
        .createIndex({ userId: 1, date: 1 });
      await mongoose.connection.db
        .collection("expenses")
        .createIndex({ userId: 1, date: 1 });
      await mongoose.connection.db
        .collection("budgets")
        .createIndex({ userId: 1, startDate: 1, categoryId: 1 });
      await mongoose.connection.db
        .collection("notifications")
        .createIndex({ userId: 1, createdAt: -1 });
    });

    console.log("DB connection established...");
  } catch (error) {
    console.error("DB connection failed: ", error.message);
    process.exit(1);
  }
};

// Handle reconnection on disconnect
mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected. Attempting to reconnect...");
  connectDB();
});

export default connectDB;
