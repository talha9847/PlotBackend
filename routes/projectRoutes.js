const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const projectController = require("../controllers/projectController");

// POST /api/projects
router.post("/create", auth.authenticate, projectController.createProject);
router.post(
  "/managePlots",
  auth.authenticate,
  projectController.manageProjectPlots,
);

router.get(
  "/:projectUuid/location",
  auth.authenticate,
  projectController.getProjectLocation,
);

router.patch(
  "/:projectUuid/location",
  auth.authenticate,
  projectController.updateProjectLocation,
);
router.get("/stats", auth.authenticate, projectController.getProjectStats);
router.get("/getProjects", auth.authenticate, projectController.getProjects);
module.exports = router;
