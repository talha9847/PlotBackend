const customerService = require("../services/customerService");

const ALLOWED_STATUSES = [
  "On track",
  "Due soon",
  "Overdue",
  "Paid",
  "Cancelled",
];

const ALLOWED_SORTS = [
  "name",
  "phone",
  "project",
  "plot",
  "total",
  "paid",
  "balance",
  "status",
  "booking_date",
];

async function getCustomers(req, res) {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      projectId,
      status,
      sortBy = "booking_date",
      sortOrder = "desc",
    } = req.query;

    if (
      !/^[1-9]\d*$/.test(String(page)) ||
      !/^[1-9]\d*$/.test(String(limit)) ||
      Number(limit) > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid page or limit. Limit must be between 1 and 100.",
      });
    }

    if (typeof search !== "string" || search.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Search must be a string of at most 100 characters",
      });
    }

    if (projectId !== undefined && !/^[1-9]\d*$/.test(String(projectId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid project ID",
      });
    }

    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer payment status",
      });
    }

    if (!ALLOWED_SORTS.includes(sortBy)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sort field",
      });
    }

    if (!["asc", "desc"].includes(String(sortOrder).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Sort order must be asc or desc",
      });
    }

    const result = await customerService.getCustomers({
      page: Number(page),
      limit: Number(limit),
      search: search.trim(),
      projectId: projectId ? Number(projectId) : null,
      status: status || null,
      sortBy,
      sortOrder,
    });

    return res.status(200).json({
      success: true,
      message: "Customers fetched successfully",
      data: result,
    });
  } catch (error) {
    console.error("Get customers error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
    });
  }
}

const getCustomerProfile = async (req, res, next) => {
  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({
        success: false,
        message: "Customer UUID is required",
      });
    }

    const profile = await customerService.getCustomerProfile(uuid);

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Customer profile fetched successfully",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getCustomers, getCustomerProfile };
