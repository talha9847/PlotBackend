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
const partyRoutes = require("./routes/partyRoutes");
const categoryRoutes = require("./routes/categoryRoutes");

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
app.use("/api/parties", partyRoutes);
app.use("/api/categories", categoryRoutes);
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

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Plotwise API running at http://localhost:${PORT}`);
});
server.on("error", (error) => {
  console.error("HTTP server error:", error);
});

server.on("close", () => {
  console.error("HTTP server closed unexpectedly");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

async function dropAllTables() {
  const { pool, query } = require("./config/db");

  try {
    await query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = 'public'
        )
        LOOP
          EXECUTE format(
            'DROP TABLE IF EXISTS public.%I CASCADE',
            r.tablename
          );
        END LOOP;
      END $$;
    `);

    console.log("All tables dropped successfully.");
  } catch (error) {
    console.error("Error dropping tables:", error);
    throw error;
  }
}


