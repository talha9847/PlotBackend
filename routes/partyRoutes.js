const express = require("express");
const router = express.Router();

const partyController = require("../controllers/partyController");
const auth = require("../middlewares/authMiddleware");

router.post("/", auth.authenticate, partyController.createParty);
router.get("/", auth.authenticate, partyController.getParties);
router.get("/:uuid", auth.authenticate, partyController.getPartyByUuid);
router.patch("/:uuid", auth.authenticate, partyController.updateParty);
router.patch(
  "/:uuid/status",
  auth.authenticate,
  partyController.setPartyActive,
);
router.delete("/:uuid", auth.authenticate, partyController.deleteParty);

module.exports = router;
