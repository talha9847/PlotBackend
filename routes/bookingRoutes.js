"use strict";

const express = require("express");
const router = express.Router();

const bookingController = require("../controllers/bookingController");
const auth = require("../middlewares/authMiddleware");

router.post(
  "/create",
  auth.authenticate,
  auth.authorize("admin", "manager", "sales"),
  bookingController.createBooking,
);
router.post(
  "/confirm/:bookingUuid",
  auth.authenticate,
  auth.authorize("admin", "manager"),
  bookingController.confirmBooking,
);
router.post(
  "/:bookingUuid/cancel",
  auth.authenticate,
  auth.authorize("admin", "manager"),
  bookingController.cancelBooking,
);
router.get("/", auth.authenticate, bookingController.getBookings);

module.exports = router;
