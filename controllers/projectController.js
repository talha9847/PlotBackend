const projectService = require("../services/projectService");

const PROJECT_TYPES = [
  "residential",
  "commercial",
  "industrial",
  "mixed_use",
  "agricultural",
  "other",
];

const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
];

const AREA_UNITS = [
  "sq_ft",
  "sq_m",
  "sq_yd",
  "acre",
  "hectare",
  "guntha",
  "bigha",
  "other",
];

const OPTIONAL_TEXT_FIELDS = {
  address_line1: 10000,
  address_line2: 10000,
  city: 100,
  district: 100,
  state: 100,
  postal_code: 20,
};

function validateProject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Request body must be a valid object.";
  }

  const {
    name,
    plots,
    project_type = "residential",
    status = "active",
    total_area,
    area_unit = "sq_ft",
  } = data;

  if (typeof name !== "string" || !name.trim()) {
    return "Project name is required.";
  }

  if (name.trim().length > 100) {
    return "Project name must not exceed 100 characters.";
  }

  if (
    typeof plots !== "number" ||
    !Number.isSafeInteger(plots) ||
    plots < 1 ||
    plots > 10000
  ) {
    return "Plots must be an integer between 1 and 10000.";
  }

  if (!PROJECT_TYPES.includes(project_type)) {
    return "Invalid project type.";
  }

  if (!PROJECT_STATUSES.includes(status)) {
    return "Invalid project status.";
  }

  if (!AREA_UNITS.includes(area_unit)) {
    return "Invalid area unit.";
  }

  for (const [field, maxLength] of Object.entries(OPTIONAL_TEXT_FIELDS)) {
    const value = data[field];

    if (
      value != null &&
      (typeof value !== "string" || value.length > maxLength)
    ) {
      return `${field} must be a string of at most ${maxLength} characters.`;
    }
  }

  if (total_area !== undefined && total_area !== null && total_area !== "") {
    const areaString = String(total_area);

    if (!/^\d+(\.\d{1,3})?$/.test(areaString)) {
      return "Total area must be non-negative with at most 3 decimal places.";
    }

    const area = Number(areaString);

    if (!Number.isFinite(area) || area > 9999999999999.999) {
      return "Total area is outside the supported range.";
    }
  }

  return null;
}

async function createProject(req, res) {
  try {
    const validationError = validateProject(req.body);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const data = {
      ...req.body,
      name: req.body.name.trim(),
      plots: req.body.plots,
      project_type: req.body.project_type ?? "residential",
      status: req.body.status ?? "active",
      area_unit: req.body.area_unit ?? "sq_ft",
      total_area:
        req.body.total_area === "" || req.body.total_area == null
          ? null
          : Number(req.body.total_area),
    };

    const project = await projectService.createProject(
      data,
      req.user?.id ?? null,
    );

    return res.status(201).json({
      success: true,
      message: "Project and plots created successfully.",
      data: project,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Create project error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create project. Please try again.",
    });
  }
}

async function getProjects(req, res, next) {
  try {
    const projects = await projectService.getProjects();

    return res.status(200).json({
      success: true,
      message: "Projects fetched successfully",
      data: {
        projects,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getProjectStats(req, res, next) {
  try {
    const stats = await projectService.getProjectStats();

    return res.status(200).json({
      success: true,
      message: "Project statistics fetched successfully",
      data: {
        stats,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function manageProjectPlots(req, res, next) {
  try {
    const { project_id, action, count } = req.body;

    const result = await projectService.manageProjectPlots({
      project_id,
      action,
      count,
      createdBy: req.user?.id ?? null,
    });

    return res.status(200).json({
      success: true,
      message:
        action === "add"
          ? "Plots added successfully."
          : "Plots deleted successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function updateProjectLocation(req, res, next) {
  try {
    const { projectUuid } = req.params;

    const {  address, latitude, longitude, googleMapsUrl } =
      req.body;



    if (!address?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Address is required.",
      });
    }

    if (
      latitude === undefined ||
      longitude === undefined ||
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude)) ||
      Number(latitude) < -90 ||
      Number(latitude) > 90 ||
      Number(longitude) < -180 ||
      Number(longitude) > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid latitude and longitude are required.",
      });
    }

    const project = await projectService.updateProjectLocationByUuid(
      projectUuid,
      {
        address: address.trim(),
        latitude: Number(latitude),
        longitude: Number(longitude),
        googleMapsUrl,
      },
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Project location updated successfully.",
      data: project,
    });
  } catch (error) {
    next(error);
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getProjectLocation(req, res, next) {
  try {
    const { projectUuid } = req.params;

    if (!UUID_REGEX.test(projectUuid)) {
      return res.status(400).json({
        success: false,
        message: "Invalid project UUID",
      });
    }

    const project = await projectService.getProjectLocationByUuid(projectUuid);

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Project location fetched successfully",
      data: project,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createProject,
  getProjects,
  getProjectStats,
  updateProjectLocation,
  getProjectLocation,
  manageProjectPlots,
};
