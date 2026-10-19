"use strict";

const express = require("express");
const router = express.Router();

const customerController = require("../controllers/customerController");
const installmentController = require("../controllers/installmentController");
const auth = require("../middlewares/authMiddleware");

router.get(
  "/dropdown",
  auth.authenticate,
  customerController.getCustomersDropdown,
);

router.get("/", auth.authenticate, customerController.getCustomers);

router.get(
  "/:uuid/profile",
  auth.authenticate,
  customerController.getCustomerProfile,
);

router.get(
  "/installments",
  auth.authenticate,
  installmentController.getInstallments,
);

module.exports = router;
