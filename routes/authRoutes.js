const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");

const authController = require("../controllers/authController");

router.post("/login", authController.login);
router.get("/me", auth.authenticate, authController.me);

router.post("/reset-password", auth.authenticate, authController.resetPassword);

module.exports = router;
