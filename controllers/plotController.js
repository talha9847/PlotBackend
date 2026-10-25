const plotService = require("../services/plotService");

const isValidUuid = (uuid) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);

// GET /api/plots/projects
const getProjects = async (req, res, next) => {
  try {
    const projects = await plotService.getProjects();

    return res.status(200).json({
      success: true,
      message: "Projects fetched successfully",
      data: { projects },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/plots/projects/:uuid/stats
const getPlotStats = async (req, res, next) => {
  try {
    const { uuid } = req.params;

    if (!isValidUuid(uuid)) {
      return res.status(400).json({
        success: false,
        message: "Invalid project UUID",
      });
    }

    const result = await plotService.getPlotStats(uuid);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Plot statistics fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/plots/projects/:uuid

const getPlotsByProjectUuid = async (req, res, next) => {
  try {
    const { uuid } = req.params;

    if (!isValidUuid(uuid)) {
      return res.status(400).json({
        success: false,
        message: "Invalid project UUID",
      });
    }

    const {
      page = "1",
      limit = "10",
      search = "",
      sortBy = "plot_number",
      sortOrder = "asc",
      status = "",
      plotType = "",
    } = req.query;

    const result = await plotService.getPlotsByProjectUuid(uuid, {
      page,
      limit,
      search,
      sortBy,
      sortOrder,
      status,
      plotType,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Plots fetched successfully",
      data: result,
    });
  } catch (error) {
    if (
      error.message === "Invalid plot status filter" ||
      error.message === "Invalid plot type filter"
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
};

async function getPlotsDropdown(req, res) {
  try {
    const { projectId, search } = req.query;

    if (
      projectId !== undefined &&
      (!/^\d+$/.test(projectId) || Number(projectId) < 1)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid projectId",
      });
    }

    if (search !== undefined && typeof search !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid search parameter",
      });
    }

    const plots = await plotService.getPlotsDropdown({
      projectId,
      search,
    });

    return res.status(200).json({
      success: true,
      count: plots.length,
      data: plots,
    });
  } catch (error) {
    console.error("Get plots dropdown error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch plots",
    });
  }
}

async function getPlotsDropdown2(req, res) {
  try {
    const { projectId, search } = req.query;

    if (
      projectId !== undefined &&
      (!/^\d+$/.test(projectId) || Number(projectId) < 1)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid projectId",
      });
    }

    if (search !== undefined && typeof search !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid search parameter",
      });
    }

    const plots = await plotService.getPlotsDropdown2({
      projectId,
      search,
    });

    return res.status(200).json({
      success: true,
      count: plots.length,
      data: plots,
    });
  } catch (error) {
    console.error("Get plots dropdown error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch plots",
    });
  }
}

const PLOT_TYPES = [
  "residential",
  "commercial",
  "industrial",
  "agricultural",
  "other",
];

const PLOT_STATUSES = [
  "available",
  "reserved",
  "booked",
  "sold",
  "blocked",
  "under_development",
];

const FACINGS = [
  "north",
  "south",
  "east",
  "west",
  "north_east",
  "north_west",
  "south_east",
  "south_west",
];

const DIMENSIONS = ["ft", "mt"];

const MAX_MONEY = 999999999999.99;
const MAX_DIMENSION = 99999999.99;

const parseOptionalNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }

  if (typeof value !== "number" && typeof value !== "string") {
    return { ok: false };
  }

  const raw =
    typeof value === "string" ? value.replace(/,/g, "").trim() : value;

  if (raw === "") {
    return { ok: true, value: null };
  }

  const number = Number(raw);

  return Number.isFinite(number)
    ? { ok: true, value: number }
    : { ok: false };
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") return { ok: true, value };
  if (value === 1 || value === "1" || value === "true")
    return { ok: true, value: true };
  if (value === 0 || value === "0" || value === "false")
    return { ok: true, value: false };
  return { ok: false };
};

const normalizePlotUpdate = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a valid object." };
  }

  const data = {};
  const has = (key) => Object.hasOwn(body, key);

  if (has("plot_type") || has("plotType")) {
    const value = has("plot_type") ? body.plot_type : body.plotType;

    if (typeof value !== "string" || !PLOT_TYPES.includes(value)) {
      return { ok: false, message: "Invalid plot type." };
    }

    data.plot_type = value;
  }

  if (has("price") || has("base_price") || has("basePrice")) {
    const value = has("price")
      ? body.price
      : has("base_price")
        ? body.base_price
        : body.basePrice;
    const parsed = parseOptionalNumber(value);

    if (
      !parsed.ok ||
      parsed.value === null ||
      parsed.value < 0 ||
      parsed.value > MAX_MONEY
    ) {
      return {
        ok: false,
        message: `Price must be a number between 0 and ${MAX_MONEY}.`,
      };
    }

    data.base_price = parsed.value;
  }

  for (const [key, column] of [
    ["length", "length"],
    ["breadth", "breadth"],
  ]) {
    if (!has(key)) continue;

    const parsed = parseOptionalNumber(body[key]);

    if (
      !parsed.ok ||
      (parsed.value !== null &&
        (parsed.value <= 0 || parsed.value > MAX_DIMENSION))
    ) {
      return {
        ok: false,
        message: `${
          key.charAt(0).toUpperCase() + key.slice(1)
        } must be a positive number up to ${MAX_DIMENSION}, or empty.`,
      };
    }

    data[column] = parsed.value;
  }

  if (has("dimension")) {
    if (!DIMENSIONS.includes(body.dimension)) {
      return { ok: false, message: "Dimension must be either ft or mt." };
    }

    data.dimension = body.dimension;
  }

  if (has("status")) {
    if (!PLOT_STATUSES.includes(body.status)) {
      return { ok: false, message: "Invalid plot status." };
    }

    data.status = body.status;
  }

  if (has("facing")) {
    const value =
      body.facing === null || body.facing === undefined || body.facing === ""
        ? null
        : String(body.facing).trim().toLowerCase();

    if (value !== null && !FACINGS.includes(value)) {
      return { ok: false, message: "Invalid facing direction." };
    }

    data.facing = value;
  }

  for (const [key, column] of [
    ["is_corner", "is_corner"],
    ["isCorner", "is_corner"],
    ["boundary_wall", "boundary_wall"],
    ["boundaryWall", "boundary_wall"],
  ]) {
    if (!has(key)) continue;

    const parsed = parseBoolean(body[key]);

    if (!parsed.ok) {
      return {
        ok: false,
        message: `${key} must be a boolean value.`,
      };
    }

    data[column] = parsed.value;
  }

  if (has("road_width") || has("roadWidth")) {
    const parsed = parseOptionalNumber(
      has("road_width") ? body.road_width : body.roadWidth,
    );

    if (
      !parsed.ok ||
      (parsed.value !== null &&
        (parsed.value < 0 || parsed.value > MAX_DIMENSION))
    ) {
      return {
        ok: false,
        message: `Road width must be a number between 0 and ${MAX_DIMENSION}, or empty.`,
      };
    }

    data.road_width = parsed.value;
  }

  if (has("notes")) {
    if (body.notes === null) {
      data.notes = null;
    } else if (typeof body.notes !== "string") {
      return { ok: false, message: "Notes must be a string." };
    } else if (body.notes.length > 5000) {
      return { ok: false, message: "Notes cannot exceed 5000 characters." };
    } else {
      data.notes = body.notes.trim() || null;
    }
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, message: "No editable plot fields were provided." };
  }

  return { ok: true, data };
};

// PUT /api/plots/:uuid
const updatePlot = async (req, res, next) => {
  try {
    const { uuid } = req.params;

    if (!isValidUuid(uuid)) {
      return res.status(400).json({
        success: false,
        message: "Invalid plot UUID",
      });
    }

    const parsed = normalizePlotUpdate(req.body);

    if (!parsed.ok) {
      return res.status(400).json({
        success: false,
        message: parsed.message,
      });
    }

    const plot = await plotService.updatePlotByUuid(uuid, parsed.data);

    if (!plot) {
      return res.status(404).json({
        success: false,
        message: "Plot not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Plot updated successfully",
      data: { plot },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
};

module.exports = {
  getProjects,
  getPlotStats,
  getPlotsByProjectUuid,
  getPlotsDropdown,
  getPlotsDropdown2,
  updatePlot,
};
