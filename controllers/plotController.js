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

module.exports = {
  getProjects,
  getPlotStats,
  getPlotsByProjectUuid,
};
