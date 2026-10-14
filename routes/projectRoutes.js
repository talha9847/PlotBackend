const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const projectController = require("../controllers/projectController");

// POST /api/projects
router.post("/create", auth.authenticate, projectController.createProject);
router.get("/stats", auth.authenticate, projectController.getProjectStats);
router.get("/getProjects", auth.authenticate, projectController.getProjects);
module.exports = router;
