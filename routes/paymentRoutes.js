"use strict";

const express = require("express");
const router = express.Router();

const paymentController = require("../controllers/paymentController");
const auth = require("../middlewares/authMiddleware");

router.post(
  "/received",
  auth.authenticate,
  auth.authorize("admin", "manager", "accountant"),
  paymentController.receivePayment,
);
router.post(
  "/:uuid/refund",
  auth.authenticate,
  auth.authorize("admin", "manager"),
  paymentController.refundPayment,
);

module.exports = router;
