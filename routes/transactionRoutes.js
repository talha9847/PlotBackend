const express = require("express");
const router = express.Router();

const transactionController = require("../controllers/transactionController");
const auth = require("../middlewares/authMiddleware");
// Register export before any dynamic /:uuid route.
router.get(
  "/export",
  auth.authenticate,
  transactionController.exportTransactions,
);
router.get("/", auth.authenticate, transactionController.getTransactions);

module.exports = router;
