const express = require("express");
const router = express.Router();

const paymentController = require("../controllers/paymentController");
const auth = require("../middlewares/authMiddleware");

router.post("/receive", auth.authenticate, paymentController.receivePayment);
module.exports = router;
