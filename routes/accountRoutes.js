const express = require("express");
const accountController = require("../controllers/accountController");

const router = express.Router();
const auth = require("../middlewares/authMiddleware");

router.post("/create", auth.authenticate, accountController.createAccount);

router.get("/", auth.authenticate, accountController.getAccounts);

router.get("/:accountId", auth.authenticate, accountController.getAccountById);

router.put("/:accountId", auth.authenticate, accountController.updateAccount);

module.exports = router;
