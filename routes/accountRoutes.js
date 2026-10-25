"use strict";

const express = require("express");
const accountController = require("../controllers/accountController");

const router = express.Router();
const auth = require("../middlewares/authMiddleware");

const FINANCE_READ_ROLES = [
  "admin",
  "manager",
  "accountant",
  "sales",
  "viewer",
];
const ACCOUNT_ADMIN_ROLES = ["admin", "manager"];
const ACCOUNT_BALANCE_ROLES = ["admin", "manager", "accountant"];

router.post(
  "/create",
  auth.authenticate,
  auth.authorize(...ACCOUNT_ADMIN_ROLES),
  accountController.createAccount,
);
router.get(
  "/balances",
  auth.authenticate,
  auth.authorize(...ACCOUNT_BALANCE_ROLES),
  accountController.getAccountBalances,
);
router.get(
  "/:accountUuid/transactions",
  auth.authenticate,
  auth.authorize(...FINANCE_READ_ROLES),
  accountController.getTransactionsByAccount,
);
router.get(
  "/",
  auth.authenticate,
  auth.authorize(...FINANCE_READ_ROLES),
  accountController.getAccounts,
);
router.get(
  "/:accountId",
  auth.authenticate,
  auth.authorize(...FINANCE_READ_ROLES),
  accountController.getAccountById,
);
router.put(
  "/:accountId",
  auth.authenticate,
  auth.authorize(...ACCOUNT_ADMIN_ROLES),
  accountController.updateAccount,
);

module.exports = router;
