const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const projectController = require("../controllers/projectController");

// POST /api/projects
router.post("/", auth.authenticate, projectController.createProject);
router.get("/stats", auth.authenticate, projectController.getProjectStats);
router.get("/", auth.authenticate, projectController.getProjects);
module.exports = router;
