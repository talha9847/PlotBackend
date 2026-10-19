const transactionService = require("../services/transactionService");

const METHODS = ["cash", "upi", "bank_transfer", "card", "cheque", "other"];

const STATUSES = [
  "pending",
  "completed",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
];

const isPositiveInteger = (value) =>
  /^\d+$/.test(String(value)) && Number(value) > 0;

const isValidDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function validateFilters(query) {
  const {
    search,
    customer_id,
    project_id,
    plot_id,
    account_id,
    payment_method,
    status,
    start_date,
    end_date,
    min_amount,
    max_amount,
  } = query;

  if (search !== undefined && typeof search !== "string") {
    return "Invalid search parameter";
  }

  for (const [key, value] of Object.entries({
    customer_id,
    project_id,
    plot_id,
    account_id,
  })) {
    if (value !== undefined && !isPositiveInteger(value)) {
      return `Invalid ${key}`;
    }
  }

  if (payment_method !== undefined && !METHODS.includes(payment_method)) {
    return "Invalid payment_method";
  }

  if (status !== undefined && !STATUSES.includes(status)) {
    return "Invalid status";
  }

  if (start_date !== undefined && !isValidDate(start_date)) {
    return "Invalid start_date";
  }

  if (end_date !== undefined && !isValidDate(end_date)) {
    return "Invalid end_date";
  }

  if (start_date && end_date && start_date > end_date) {
    return "start_date must be before or equal to end_date";
  }

  for (const [key, value] of Object.entries({
    min_amount,
    max_amount,
  })) {
    if (
      value !== undefined &&
      (value === "" || !Number.isFinite(Number(value)) || Number(value) < 0)
    ) {
      return `Invalid ${key}`;
    }
  }

  if (
    min_amount !== undefined &&
    max_amount !== undefined &&
    Number(min_amount) > Number(max_amount)
  ) {
    return "min_amount cannot exceed max_amount";
  }

  return null;
}

function getFilters(query) {
  return {
    search: query.search,
    customer_id: query.customer_id,
    project_id: query.project_id,
    plot_id: query.plot_id,
    account_id: query.account_id,
    payment_method: query.payment_method,
    status: query.status,
    start_date: query.start_date,
    end_date: query.end_date,
    min_amount: query.min_amount,
    max_amount: query.max_amount,
  };
}

async function getTransactions(req, res) {
  try {
    const errorMessage = validateFilters(req.query);

    if (errorMessage) {
      return res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const sort_by = req.query.sort_by || "date";
    const sort_order = req.query.sort_order || "desc";

    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid page",
      });
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        message: "limit must be between 1 and 100",
      });
    }

    if (!["date", "amount", "customer", "number", "status"].includes(sort_by)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sort_by",
      });
    }

    if (!["asc", "desc"].includes(sort_order)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sort_order",
      });
    }

    const result = await transactionService.getTransactions({
      ...getFilters(req.query),
      page,
      limit,
      sort_by,
      sort_order,
    });

    return res.status(200).json({
      success: true,
      data: result.transactions,
      summary: result.summary,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Get transactions error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
    });
  }
}

async function exportTransactions(req, res) {
  try {
    const errorMessage = validateFilters(req.query);

    if (errorMessage) {
      return res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }

    const transactions = await transactionService.getTransactionsForExport(
      getFilters(req.query),
    );

    return res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error("Export transactions error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to export transactions",
    });
  }
}

module.exports = {
  getTransactions,
  exportTransactions,
};
