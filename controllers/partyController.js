const partyService = require("../services/partyService");

const PARTY_TYPES = [
  "driver",
  "employee",
  "vendor",
  "supplier",
  "landlord",
  "customer",
  "broker",
  "other",
];

const SORT_FIELDS = [
  "name",
  "phone",
  "email",
  "party_type",
  "partyType",
  "is_active",
  "isActive",
  "created_at",
  "updated_at",
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const getValue = (body, camelKey, snakeKey) => {
  if (hasOwn(body, camelKey)) return body[camelKey];
  if (hasOwn(body, snakeKey)) return body[snakeKey];
  return undefined;
};

const getCreatedBy = (req) => req.user?.id ?? req.user?.userId ?? null;

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    message,
  });

const handleError = (res, error) => {
  console.error("Party controller error:", error);

  if (error.code === "23505") {
    return sendError(
      res,
      409,
      "A party with this phone number already exists.",
    );
  }

  if (error.code === "23514" || error.code === "23503") {
    return sendError(
      res,
      400,
      "Invalid party data. Please check the supplied values.",
    );
  }

  return sendError(res, 500, "Internal server error.");
};

/**
 * Validate party request body
 */
const validatePartyBody = (body, partial = false) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a valid object.";
  }

  const allowedFields = [
    "name",
    "party_type",
    "partyType",
    "phone",
    "email",
    "address",
    "notes",
    "is_active",
    "isActive",
  ];

  const unknownFields = Object.keys(body).filter(
    (key) => !allowedFields.includes(key),
  );

  if (unknownFields.length > 0) {
    return `Unknown field(s): ${unknownFields.join(", ")}.`;
  }

  const name = body.name;
  const phone = body.phone;
  const partyType = getValue(body, "partyType", "party_type");
  const isActive = getValue(body, "isActive", "is_active");

  if (!partial || hasOwn(body, "name")) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 160) {
      return "Name is required and must be at most 160 characters.";
    }
  }

  if (!partial || hasOwn(body, "phone")) {
    if (
      typeof phone !== "string" ||
      !phone.trim() ||
      phone.trim().length > 30
    ) {
      return "Phone is required and must be at most 30 characters.";
    }
  }

  if (partyType !== undefined) {
    if (typeof partyType !== "string" || !PARTY_TYPES.includes(partyType)) {
      return `Party type must be one of: ${PARTY_TYPES.join(", ")}.`;
    }
  }

  if (hasOwn(body, "email")) {
    const { email } = body;

    if (
      email !== null &&
      email !== "" &&
      (typeof email !== "string" ||
        email.length > 254 ||
        !EMAIL_REGEX.test(email))
    ) {
      return "Please provide a valid email address.";
    }
  }

  for (const field of ["address", "notes"]) {
    if (
      hasOwn(body, field) &&
      body[field] !== null &&
      typeof body[field] !== "string"
    ) {
      return `${field} must be a string or null.`;
    }
  }

  if (isActive !== undefined && typeof isActive !== "boolean") {
    return "is_active must be a boolean.";
  }

  if (partial && Object.keys(body).length === 0) {
    return "Provide at least one field to update.";
  }

  return null;
};

/**
 * POST /api/parties
 * Create party
 */
const createParty = async (req, res) => {
  try {
    const validationError = validatePartyBody(req.body);

    if (validationError) {
      return sendError(res, 400, validationError);
    }

    const body = { ...req.body };

    if (hasOwn(body, "name")) {
      body.name = body.name.trim();
    }

    if (hasOwn(body, "phone")) {
      body.phone = body.phone.trim();
    }

    if (body.email === "") {
      body.email = null;
    }

    const party = await partyService.createParty(body, getCreatedBy(req));

    return res.status(201).json({
      success: true,
      message: "Party created successfully.",
      data: party,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/parties
 * Get paginated parties
 */
const getParties = async (req, res) => {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      sortBy = "created_at",
      sortOrder = "desc",
      partyType = "",
      isActive,
    } = req.query;

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      return sendError(res, 400, "Page must be a positive integer.");
    }

    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 100
    ) {
      return sendError(res, 400, "Limit must be between 1 and 100.");
    }

    if (typeof search !== "string" || search.length > 200) {
      return sendError(
        res,
        400,
        "Search must be a string of at most 200 characters.",
      );
    }

    if (!SORT_FIELDS.includes(sortBy)) {
      return sendError(res, 400, "Invalid sortBy field.");
    }

    if (!["asc", "desc"].includes(String(sortOrder).toLowerCase())) {
      return sendError(res, 400, "sortOrder must be asc or desc.");
    }

    if (partyType && !PARTY_TYPES.includes(partyType)) {
      return sendError(res, 400, "Invalid party type.");
    }

    let activeFilter;

    if (isActive !== undefined && isActive !== "") {
      if (!["true", "false"].includes(isActive)) {
        return sendError(res, 400, "isActive must be true or false.");
      }

      activeFilter = isActive === "true";
    }

    const result = await partyService.getParties({
      page: parsedPage,
      limit: parsedLimit,
      search: search.trim(),
      sortBy,
      sortOrder: String(sortOrder).toLowerCase(),
      partyType,
      isActive: activeFilter,
    });

    return res.status(200).json({
      success: true,
      message: "Parties fetched successfully.",
      data: result.parties,
      pagination: result.pagination,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/parties/:uuid
 * Get party by UUID
 */
const getPartyByUuid = async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return sendError(res, 400, "Invalid party UUID.");
    }

    const party = await partyService.getPartyByUuid(uuid);

    if (!party) {
      return sendError(res, 404, "Party not found.");
    }

    return res.status(200).json({
      success: true,
      data: party,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PATCH /api/parties/:uuid
 * Update party
 */
const updateParty = async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return sendError(res, 400, "Invalid party UUID.");
    }

    const validationError = validatePartyBody(req.body, true);

    if (validationError) {
      return sendError(res, 400, validationError);
    }

    const body = { ...req.body };

    if (hasOwn(body, "name")) {
      body.name = body.name.trim();
    }

    if (hasOwn(body, "phone")) {
      body.phone = body.phone.trim();
    }

    if (body.email === "") {
      body.email = null;
    }

    const party = await partyService.updatePartyByUuid(uuid, body);

    if (!party) {
      return sendError(res, 404, "Party not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Party updated successfully.",
      data: party,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PATCH /api/parties/:uuid/status
 * Change active status
 */
const setPartyActive = async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return sendError(res, 400, "Invalid party UUID.");
    }

    const isActive = getValue(req.body || {}, "isActive", "is_active");

    if (typeof isActive !== "boolean") {
      return sendError(res, 400, "is_active must be true or false.");
    }

    const party = await partyService.setPartyActiveByUuid(uuid, isActive);

    if (!party) {
      return sendError(res, 404, "Party not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Party status updated successfully.",
      data: party,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * DELETE /api/parties/:uuid
 * Soft delete party
 */
const deleteParty = async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return sendError(res, 400, "Invalid party UUID.");
    }

    const party = await partyService.deletePartyByUuid(uuid);

    if (!party) {
      return sendError(res, 404, "Party not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Party deleted successfully.",
    });
  } catch (error) {
    return handleError(res, error);
  }
};

async function getPartiesDropdown(req, res) {
  try {
    const { search } = req.query;

    if (search !== undefined && typeof search !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid search parameter",
      });
    }

    const parties = await partyService.getPartiesDropdown({
      search,
    });

    return res.status(200).json({
      success: true,
      count: parties.length,
      data: parties,
    });
  } catch (error) {
    console.error("Get parties dropdown error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch parties",
    });
  }
}

module.exports = {
  createParty,
  getParties,
  getPartyByUuid,
  updateParty,
  setPartyActive,
  getPartiesDropdown,
  deleteParty,
};
