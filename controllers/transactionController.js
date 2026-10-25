"use strict";

const transactionService = require("../services/transactionService");
const financeService = require("../services/financeService");

const {
  SOURCE_TYPES,
  KINDS,
  DIRECTIONS,
  CHANNELS,
  PAYMENT_METHODS,
  STATUSES,
} = transactionService;

const { getIdempotencyKey } = financeService;

const SORT_FIELDS = ["date", "amount", "customer", "number", "status"];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isPositiveInteger = (value) =>
  /^\d+$/.test(String(value)) && Number(value) > 0;

const isValidAmount = (value) =>
  (typeof value === "string" || typeof value === "number") &&
  /^\d+(\.\d{1,2})?$/.test(String(value)) &&
  Number.isFinite(Number(value)) &&
  Number(value) > 0 &&
  Number(value) <= 999999999999.99;

const isValidDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function validateFilters(query) {
  const {
    search,
    source_type,
    kind,
    direction,
    channel,
    customer_id,
    project_id,
    plot_id,
    account_id,
    party_id,
    category_id,
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

  if (source_type !== undefined && !SOURCE_TYPES.includes(source_type)) {
    return "Invalid source_type";
  }

  if (kind !== undefined && !KINDS.includes(kind)) {
    return "Invalid kind";
  }

  if (direction !== undefined && !DIRECTIONS.includes(direction)) {
    return "Invalid direction";
  }

  if (channel !== undefined && !CHANNELS.includes(channel)) {
    return "Invalid channel";
  }

  for (const [key, value] of Object.entries({
    customer_id,
    project_id,
    plot_id,
    account_id,
    party_id,
    category_id,
  })) {
    if (value !== undefined && !isPositiveInteger(value)) {
      return `Invalid ${key}`;
    }
  }

  if (
    payment_method !== undefined &&
    !PAYMENT_METHODS.includes(payment_method)
  ) {
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

  for (const [key, value] of Object.entries({ min_amount, max_amount })) {
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
    source_type: query.source_type,
    kind: query.kind,
    direction: query.direction,
    channel: query.channel,
    customer_id: query.customer_id,
    project_id: query.project_id,
    plot_id: query.plot_id,
    account_id: query.account_id,
    party_id: query.party_id,
    category_id: query.category_id,
    payment_method: query.payment_method,
    status: query.status,
    start_date: query.start_date,
    end_date: query.end_date,
    min_amount: query.min_amount,
    max_amount: query.max_amount,
  };
}

function validatePagination(query) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 10);
  const sort_by = query.sort_by || "date";
  const sort_order = query.sort_order || "desc";

  if (!Number.isInteger(page) || page < 1) {
    return { error: "Invalid page" };
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { error: "limit must be between 1 and 100" };
  }

  if (!SORT_FIELDS.includes(sort_by)) {
    return { error: "Invalid sort_by" };
  }

  if (!["asc", "desc"].includes(sort_order)) {
    return { error: "Invalid sort_order" };
  }

  return { page, limit, sort_by, sort_order };
}

async function getTransactions(req, res) {
  const errorMessage = validateFilters(req.query);

  if (errorMessage) {
    return res.status(400).json({
      success: false,
      message: errorMessage,
    });
  }

  const pagination = validatePagination(req.query);

  if (pagination.error) {
    return res.status(400).json({
      success: false,
      message: pagination.error,
    });
  }

  try {
    const result = await transactionService.getTransactions({
      ...getFilters(req.query),
      page: pagination.page,
      limit: pagination.limit,
      sort_by: pagination.sort_by,
      sort_order: pagination.sort_order,
    });

    return res.status(200).json({
      success: true,
      data: {
        transactions: result.transactions,
        summary: result.summary,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error("Get transactions error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
    });
  }
}

async function getTransactionDetail(req, res) {
  const { sourceType, uuid } = req.params;
  const { source_row_id: sourceRowId } = req.query;

  if (!SOURCE_TYPES.includes(sourceType)) {
    return res.status(400).json({
      success: false,
      message: "Invalid source type",
    });
  }

  if (!UUID_REGEX.test(uuid)) {
    return res.status(400).json({
      success: false,
      message: "A valid transaction UUID is required",
    });
  }

  if (
    sourceRowId !== undefined &&
    (typeof sourceRowId !== "string" || sourceRowId.length > 100)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid source_row_id",
    });
  }

  try {
    const transaction = await transactionService.getTransactionDetail({
      sourceType,
      uuid,
      sourceRowId: sourceRowId || null,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: { transaction },
    });
  } catch (error) {
    console.error("Get transaction detail error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch transaction",
    });
  }
}

async function exportTransactions(req, res) {
  const errorMessage = validateFilters(req.query);

  if (errorMessage) {
    return res.status(400).json({
      success: false,
      message: errorMessage,
    });
  }

  try {
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

async function createTransaction(req, res, next) {
  try {
    const body = req.body || {};
    const {
      transaction_type,
      amount,
      category_id,
      party_id,
      account_id,
      transaction_date,
      payment_method,
      reference_number,
      notes,
    } = body;

    if (!["income", "expense"].includes(transaction_type)) {
      return res.status(400).json({
        success: false,
        message: "Transaction type must be income or expense.",
      });
    }

    if (!isValidAmount(amount)) {
      return res.status(400).json({
        success: false,
        message: "A valid transaction amount is required.",
      });
    }

    if (!isPositiveInteger(category_id)) {
      return res.status(400).json({
        success: false,
        message: "A valid category is required.",
      });
    }

    if (
      party_id !== undefined &&
      party_id !== null &&
      party_id !== "" &&
      !isPositiveInteger(party_id)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid party_id",
      });
    }

    if (!PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        message: "A valid payment method is required.",
      });
    }

    if (payment_method !== "cash" && !isPositiveInteger(account_id)) {
      return res.status(400).json({
        success: false,
        message: "A bank account is required for non-cash transactions.",
      });
    }

    if (
      transaction_date !== undefined &&
      transaction_date !== null &&
      transaction_date !== "" &&
      !isValidDate(transaction_date)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction_date",
      });
    }

    if (
      reference_number !== undefined &&
      reference_number !== null &&
      (typeof reference_number !== "string" || reference_number.length > 150)
    ) {
      return res.status(400).json({
        success: false,
        message: "Reference number must be at most 150 characters.",
      });
    }

    if (
      notes !== undefined &&
      notes !== null &&
      (typeof notes !== "string" || notes.length > 5000)
    ) {
      return res.status(400).json({
        success: false,
        message: "Notes must be at most 5000 characters.",
      });
    }

    const result = await transactionService.createFinancialTransaction(
      {
        transaction_type,
        amount: String(amount),
        category_id: Number(category_id),
        party_id: party_id === "" ? null : party_id,
        account_id: isPositiveInteger(account_id) ? Number(account_id) : null,
        transaction_date: transaction_date || null,
        payment_method,
        reference_number: reference_number?.trim() || null,
        notes: notes?.trim() || null,
      },
      req.user?.id ?? null,
      getIdempotencyKey(req),
    );

    return res.status(201).json({
      success: true,
      message: result.idempotent_replay
        ? "Transaction was already recorded."
        : "Transaction recorded successfully.",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

async function createTransfer(req, res, next) {
  try {
    const body = req.body || {};
    const {
      from_account_id,
      to_account_id,
      amount,
      transfer_date,
      reference_number,
      notes,
    } = body;

    if (
      !isPositiveInteger(from_account_id) ||
      !isPositiveInteger(to_account_id)
    ) {
      return res.status(400).json({
        success: false,
        message: "Source and destination accounts are required.",
      });
    }

    if (Number(from_account_id) === Number(to_account_id)) {
      return res.status(400).json({
        success: false,
        message: "Source and destination accounts must be different.",
      });
    }

    if (!isValidAmount(amount)) {
      return res.status(400).json({
        success: false,
        message: "A valid transfer amount is required.",
      });
    }

    if (
      transfer_date !== undefined &&
      transfer_date !== null &&
      transfer_date !== "" &&
      !isValidDate(transfer_date)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid transfer_date",
      });
    }

    if (
      reference_number !== undefined &&
      reference_number !== null &&
      (typeof reference_number !== "string" || reference_number.length > 150)
    ) {
      return res.status(400).json({
        success: false,
        message: "Reference number must be at most 150 characters.",
      });
    }

    if (
      notes !== undefined &&
      notes !== null &&
      (typeof notes !== "string" || notes.length > 5000)
    ) {
      return res.status(400).json({
        success: false,
        message: "Notes must be at most 5000 characters.",
      });
    }

    const result = await transactionService.createAccountTransfer(
      {
        from_account_id: Number(from_account_id),
        to_account_id: Number(to_account_id),
        amount: String(amount),
        transfer_date: transfer_date || null,
        reference_number: reference_number?.trim() || null,
        notes: notes?.trim() || null,
      },
      req.user?.id ?? null,
      getIdempotencyKey(req),
    );

    return res.status(201).json({
      success: true,
      message: result.idempotent_replay
        ? "Transfer was already recorded."
        : "Transfer recorded successfully.",
      data: result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getTransactions,
  getTransactionDetail,
  exportTransactions,
  createTransaction,
  createTransfer,
};
