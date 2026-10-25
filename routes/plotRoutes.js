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

router.get(
  "/plots/dropdown",
  auth.authenticate,
  plotController.getPlotsDropdown,
);
router.get(
  "/plots/dropdown2",
  auth.authenticate,
  plotController.getPlotsDropdown2,
);

// Update a single plot's editable attributes.
router.put("/:uuid", auth.authenticate, plotController.updatePlot);

module.exports = router;
