"use strict";

const express = require("express");
const router = express.Router();

const bookingController = require("../controllers/bookingController");
const auth = require("../middlewares/authMiddleware");

router.post("/create", auth.authenticate, bookingController.createBooking);
router.post(
  "/confirm/:bookingUuid",
  auth.authenticate,
  bookingController.confirmBooking,
);
router.get("/", auth.authenticate, bookingController.getBookings);

module.exports = router;
