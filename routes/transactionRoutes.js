"use strict";

const express = require("express");
const router = express.Router();

const transactionController = require("../controllers/transactionController");
const auth = require("../middlewares/authMiddleware");

const FINANCE_READ_ROLES = [
  "admin",
  "manager",
  "accountant",
  "sales",
  "viewer",
];
const ACCOUNTING_WRITE_ROLES = ["admin", "manager", "accountant"];

// Register the static export and write routes before any dynamic route.
router.get(
  "/export",
  auth.authenticate,
  auth.authorize("admin", "manager", "accountant"),
  transactionController.exportTransactions,
);
router.post(
  "/transfers",
  auth.authenticate,
  auth.authorize(...ACCOUNTING_WRITE_ROLES),
  transactionController.createTransfer,
);
router.post(
  "/",
  auth.authenticate,
  auth.authorize(...ACCOUNTING_WRITE_ROLES),
  transactionController.createTransaction,
);
router.get(
  "/:sourceType/:uuid",
  auth.authenticate,
  auth.authorize(...FINANCE_READ_ROLES),
  transactionController.getTransactionDetail,
);
router.get(
  "/",
  auth.authenticate,
  auth.authorize(...FINANCE_READ_ROLES),
  transactionController.getTransactions,
);

module.exports = router;
