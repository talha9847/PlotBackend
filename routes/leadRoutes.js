const express = require("express");
const leadController = require("../controllers/leadsController");

const router = express.Router();
const auth = require("../middlewares/authMiddleware");
// POST /api/customers
router.post("/create", auth.authenticate, leadController.createLead);

// GET /api/customers?page=1&limit=10&search=talha
router.get("/dropdown", auth.authenticate, leadController.getLeadsDropdown);
router.get("/byBroker", auth.authenticate, leadController.getLeadsByBroker);
router.get("/", auth.authenticate, leadController.getLeads);

router.get("/:uuid", auth.authenticate, leadController.getLeadByUuid);

router.put("/:uuid", leadController.updateLead);

module.exports = router;
