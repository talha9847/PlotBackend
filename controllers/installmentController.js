const installmentService = require("../services/installmentService.js");

const ALLOWED_STATUSES = [
  "pending",
  "partially_paid",
  "overdue",
  "paid",
  "waived",
  "cancelled",
];

const ALLOWED_SORTS = [
  "customer_name",
  "project_name",
  "plot_number",
  "installment_number",
  "due_date",
  "amount_due",
  "amount_paid",
  "remaining",
  "status",
];

async function getInstallments(req, res) {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      status,
      sortBy = "due_date",
      sortOrder = "asc",
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

    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid installment status",
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

    const result = await installmentService.getInstallments({
      page: Number(page),
      limit: Number(limit),
      search: search.trim(),
      status: status || null,
      sortBy,
      sortOrder,
    });

    return res.status(200).json({
      success: true,
      message: "Installments fetched successfully",
      data: result,
    });
  } catch (error) {
    console.error("Get installments error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch installments",
    });
  }
}
module.exports = { getInstallments };
