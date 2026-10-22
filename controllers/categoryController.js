const categoryService = require("../services/categoryService");

const SORT_FIELDS = [
  "name",
  "is_active",
  "isActive",
  "created_at",
  "updated_at",
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  console.error("Category controller error:", error);

  if (error.code === "23505") {
    return sendError(res, 409, "A category with this name already exists.");
  }

  if (error.code === "23514" || error.code === "23503") {
    return sendError(
      res,
      400,
      "Invalid category data. Please check the supplied values.",
    );
  }

  return sendError(res, 500, "Internal server error.");
};

/**
 * Validate category request body
 */
const validateCategoryBody = (body, partial = false) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a valid object.";
  }

  const allowedFields = ["name", "description", "is_active", "isActive"];

  const unknownFields = Object.keys(body).filter(
    (key) => !allowedFields.includes(key),
  );

  if (unknownFields.length > 0) {
    return `Unknown field(s): ${unknownFields.join(", ")}.`;
  }

  const isActive = getValue(body, "isActive", "is_active");

  // Validate name
  if (!partial || hasOwn(body, "name")) {
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 100
    ) {
      return "Name is required and must be at most 100 characters.";
    }
  }

  // Validate description
  if (hasOwn(body, "description")) {
    if (body.description !== null && typeof body.description !== "string") {
      return "Description must be a string or null.";
    }
  }

  // Validate active status
  if (isActive !== undefined && typeof isActive !== "boolean") {
    return "is_active must be true or false.";
  }

  if (partial && Object.keys(body).length === 0) {
    return "Provide at least one field to update.";
  }

  return null;
};

/**
 * POST /api/transaction-categories
 * Create category
 */
const createCategory = async (req, res) => {
  try {
    const validationError = validateCategoryBody(req.body);

    if (validationError) {
      return sendError(res, 400, validationError);
    }

    const body = { ...req.body };

    body.name = body.name.trim();

    if (typeof body.description === "string") {
      body.description = body.description.trim() || null;
    }

    if (body.isActive !== undefined && body.is_active === undefined) {
      body.is_active = body.isActive;
      delete body.isActive;
    }

    const category = await categoryService.createCategory(
      body,
      getCreatedBy(req),
    );

    return res.status(201).json({
      success: true,
      message: "Category created successfully.",
      data: category,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/transaction-categories
 * Get paginated categories
 */
const getCategories = async (req, res) => {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      sortBy = "created_at",
      sortOrder = "desc",
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

    let activeFilter;

    if (isActive !== undefined && isActive !== "") {
      if (!["true", "false"].includes(isActive)) {
        return sendError(res, 400, "isActive must be true or false.");
      }

      activeFilter = isActive === "true";
    }

    const result = await categoryService.getCategories({
      page: parsedPage,
      limit: parsedLimit,
      search: search.trim(),
      sortBy,
      sortOrder: String(sortOrder).toLowerCase(),
      isActive: activeFilter,
    });

    return res.status(200).json({
      success: true,
      message: "Categories fetched successfully.",
      data: result.categories,
      pagination: result.pagination,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/transaction-categories/:uuid
 * Get category by UUID
 */
const getCategoryByUuid = async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return sendError(res, 400, "Invalid category UUID.");
    }

    const category = await categoryService.getCategoryByUuid(uuid);

    if (!category) {
      return sendError(res, 404, "Category not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Category fetched successfully.",
      data: category,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PATCH /api/transaction-categories/:uuid
 * Update category
 */
const updateCategory = async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return sendError(res, 400, "Invalid category UUID.");
    }

    const validationError = validateCategoryBody(req.body, true);

    if (validationError) {
      return sendError(res, 400, validationError);
    }

    const body = { ...req.body };

    if (hasOwn(body, "name")) {
      body.name = body.name.trim();
    }

    if (typeof body.description === "string") {
      body.description = body.description.trim() || null;
    }

    if (body.isActive !== undefined && body.is_active === undefined) {
      body.is_active = body.isActive;
      delete body.isActive;
    }

    const category = await categoryService.updateCategoryByUuid(uuid, body);

    if (!category) {
      return sendError(res, 404, "Category not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Category updated successfully.",
      data: category,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PATCH /api/transaction-categories/:uuid/status
 * Change category active status
 */
const setCategoryActive = async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return sendError(res, 400, "Invalid category UUID.");
    }

    const isActive = getValue(req.body || {}, "isActive", "is_active");

    if (typeof isActive !== "boolean") {
      return sendError(res, 400, "is_active must be true or false.");
    }

    const category = await categoryService.setCategoryActiveByUuid(
      uuid,
      isActive,
    );

    if (!category) {
      return sendError(res, 404, "Category not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Category status updated successfully.",
      data: category,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * DELETE /api/transaction-categories/:uuid
 * Soft delete category
 */
const deleteCategory = async (req, res) => {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return sendError(res, 400, "Invalid category UUID.");
    }

    const category = await categoryService.deleteCategoryByUuid(uuid);

    if (!category) {
      return sendError(res, 404, "Category not found.");
    }

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully.",
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createCategory,
  getCategories,
  getCategoryByUuid,
  updateCategory,
  setCategoryActive,
  deleteCategory,
};
