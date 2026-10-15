const express = require("express");
const customerController = require("../controllers/customerController");

const router = express.Router();
const auth = require("../middlewares/authMiddleware");
// POST /api/customers
router.post("/create", auth.authenticate, customerController.createCustomer);

// GET /api/customers?page=1&limit=10&search=talha
router.get("/", auth.authenticate, customerController.getCustomers);

router.get("/:uuid", auth.authenticate, customerController.getCustomerByUuid);

router.put("/:uuid", customerController.updateCustomer);

module.exports = router;
