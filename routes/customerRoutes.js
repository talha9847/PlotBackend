"use strict";

const express = require("express");
const router = express.Router();

const customerController = require("../controllers/customerController");
const auth = require("../middlewares/authMiddleware");

router.get("/", auth.authenticate, customerController.getCustomers);

module.exports = router;
