"use strict";

const express = require("express");
const brokerController = require("../controllers/brokerController");
const auth = require("../middlewares/authMiddleware");

const router = express.Router();

// POST /api/brokers/create
router.post("/create", auth.authenticate, brokerController.createBroker);

// GET /api/brokers?page=1&limit=10&search=talha
router.get("/getBrokers", auth.authenticate, brokerController.getBrokers);

// GET /api/brokers/:uuid
router.get(
  "/getBrokers/:uuid",
  auth.authenticate,
  brokerController.getBrokerByUuid,
);

// PUT /api/brokers/:uuid
router.put("/:uuid", auth.authenticate, brokerController.updateBroker);

router.get("/dropdown", auth.authenticate, brokerController.getAllBrokers);
module.exports = router;
