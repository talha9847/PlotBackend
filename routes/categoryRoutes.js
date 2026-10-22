const express = require("express");
const router = express.Router();

const categoryController = require("../controllers/categoryController");
const auth = require("../middlewares/authMiddleware");

router.get("/", auth.authenticate, categoryController.getCategories);
router.get("/:uuid", auth.authenticate, categoryController.getCategoryByUuid);
router.post("/", auth.authenticate, categoryController.createCategory);
router.patch(
  "/:uuid/status",
  auth.authenticate,
  categoryController.setCategoryActive,
);
router.patch("/:uuid", auth.authenticate, categoryController.updateCategory);
router.delete("/:uuid", auth.authenticate, categoryController.deleteCategory);

module.exports = router;
