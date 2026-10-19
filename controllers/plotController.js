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

module.exports = {
  getProjects,
  getPlotStats,
  getPlotsByProjectUuid,
  getPlotsDropdown,
  getPlotsDropdown2,
};
