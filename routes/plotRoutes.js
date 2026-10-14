const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");

const plotController = require("../controllers/plotController");

// Register these routes under /api/plots
router.get("/projects", auth.authenticate, plotController.getProjects);
router.get(
  "/projects/:uuid/stats",
  auth.authenticate,
  plotController.getPlotStats,
);
router.get(
  "/projects/:uuid",
  auth.authenticate,
  plotController.getPlotsByProjectUuid,
);

module.exports = router;
