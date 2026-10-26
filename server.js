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
  const statusCode = Number(err.statusCode || err.status);

  // Service and validation errors carry an explicit 4xx status. Database
  // constraint violations are mapped to a conflict response; everything else
  // remains an opaque 500 so internal details never leak to clients.
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      success: false,
      message: err.message || "Request failed",
    });
  }

  if (err.code === "23505") {
    return res.status(409).json({
      success: false,
      message: "A record with these details already exists",
    });
  }

  if (err.code === "23503") {
    return res.status(400).json({
      success: false,
      message: "A referenced record does not exist",
    });
  }

  console.error(err);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

if (require.main === module) {
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
}
app.use((req, res, next) => {
  console.log(`🌐 [${req.method}] ${req.originalUrl} <- From: ${req.get('referer') || 'Direct API'}`);
  next();
});

module.exports = app;

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

