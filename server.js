const express = require("express");
const cors = require("cors");
const pool = require("./config/db");
require("dotenv").config();
const app = express();
const PORT = process.env.PORT || 3000;
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/authRoutes");
const projectRoutes = require("./routes/projectRoutes");
const plotRoutes = require("./routes/plotRoutes");
const leadRoutes = require("./routes/leadRoutes");
const brokerRoutes = require("./routes/brokerRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const customerRoutes = require("./routes/customerRoutes");
const accountRoutes = require("./routes/accountRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const transactionRoutes = require("./routes/transactionRoutes");

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://https://plot-frontend-seven.vercel.app",
    ],
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Plotwise API is running",
  });
});

// Database health check
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "API and database are connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/plots", plotRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/brokers", brokerRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/transactions", transactionRoutes);
// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.status || 500).json({
    success: false,
    message: "Internal server error",
  });
});

// Start server
async function startServer() {
  try {
    await pool.query("SELECT 1");

    app.listen(PORT, () => {
      console.log(`Plotwise API running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to PostgreSQL:", error.message);
    process.exit(1);
  }
}

startServer();
