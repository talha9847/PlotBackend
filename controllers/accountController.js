const accountService = require("../services/accountService");

function isValidName(value) {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.trim().length <= 100
  );
}

function isValidDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function parseOpeningBalance(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { value: undefined };
  }

  if (typeof rawValue !== "string" && typeof rawValue !== "number") {
    return {
      error: "Opening balance must be a non-negative number",
    };
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < 0) {
    return {
      error: "Opening balance must be a non-negative number",
    };
  }

  if (value > 999999999999.99) {
    return {
      error: "Opening balance is too large",
    };
  }

  return { value: value.toFixed(2) };
}

async function createAccount(req, res, next) {
  try {
    const {
      account_name,
      bank_name,
      account_type,
      opening_balance,
    } = req.body || {};

    if (
      account_type !== undefined &&
      account_type !== null &&
      account_type !== "bank"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Only bank accounts can be created here. The single Cash in Hand account is managed automatically.",
      });
    }

    if (!isValidName(account_name) || !isValidName(bank_name)) {
      return res.status(400).json({
        success: false,
        message:
          "Valid account name and bank name are required (maximum 100 characters each)",
      });
    }

    const parsedOpening = parseOpeningBalance(opening_balance);

    if (parsedOpening.error) {
      return res.status(400).json({
        success: false,
        message: parsedOpening.error,
      });
    }

    const account = await accountService.createAccount({
      account_name: account_name.trim(),
      bank_name: bank_name.trim(),
      opening_balance: parsedOpening.value ?? 0,
    });

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: { account },
    });
  } catch (error) {
    next(error);
  }
}

async function updateAccount(req, res, next) {
  try {
    const { accountId } = req.params;
    const {
      account_name,
      bank_name,
      opening_balance,
      account_type,
    } = req.body || {};

    if (!/^[1-9]\d*$/.test(accountId)) {
      return res.status(400).json({
        success: false,
        message: "Valid account ID is required",
      });
    }

    if (account_type !== undefined && account_type !== null) {
      return res.status(400).json({
        success: false,
        message: "Account type cannot be changed",
      });
    }

    if (!isValidName(account_name)) {
      return res.status(400).json({
        success: false,
        message: "Valid account name is required (maximum 100 characters)",
      });
    }

    const existing = await accountService.getAccountById(accountId);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    let nextBankName = null;

    if (existing.account_type === "cash") {
      if (typeof bank_name === "string" && bank_name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Cash accounts cannot have a bank name",
        });
      }
    } else {
      if (!isValidName(bank_name)) {
        return res.status(400).json({
          success: false,
          message:
            "Valid bank name is required for bank accounts (maximum 100 characters)",
        });
      }

      nextBankName = bank_name.trim();
    }

    const parsedOpening = parseOpeningBalance(opening_balance);

    if (parsedOpening.error) {
      return res.status(400).json({
        success: false,
        message: parsedOpening.error,
      });
    }

    const account = await accountService.updateAccount(accountId, {
      account_name: account_name.trim(),
      bank_name: nextBankName,
      opening_balance: parsedOpening.value,
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Account updated successfully",
      data: { account },
    });
  } catch (error) {
    next(error);
  }
}

async function getAccountById(req, res, next) {
  try {
    const { accountId } = req.params;

    if (!/^[1-9]\d*$/.test(accountId)) {
      return res.status(400).json({
        success: false,
        message: "Valid account ID is required",
      });
    }

    const account = await accountService.getAccountById(accountId);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Account fetched successfully",
      data: { account },
    });
  } catch (error) {
    next(error);
  }
}

async function getAccounts(req, res, next) {
  try {
    const accounts = await accountService.getAccounts();

    return res.status(200).json({
      success: true,
      message: "Accounts fetched successfully",
      data: { accounts },
    });
  } catch (error) {
    next(error);
  }
}

async function getAccountBalances(req, res, next) {
  try {
    const result = await accountService.getAccountBalances();

    return res.status(200).json({
      success: true,
      message: "Account balances fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function getTransactionsByAccount(req, res, next) {
  try {
    const { accountUuid } = req.params;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(accountUuid)) {
      return res.status(400).json({
        success: false,
        message: "A valid account UUID is required",
      });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10),
    );

    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    const kind =
      typeof req.query.kind === "string" && req.query.kind
        ? req.query.kind
        : undefined;
    const direction =
      typeof req.query.direction === "string" && req.query.direction
        ? req.query.direction
        : undefined;

    if (
      kind !== undefined &&
      ![
        "booking_token",
        "down_payment",
        "installment",
        "income",
        "expense",
      ].includes(kind)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction kind",
      });
    }

    if (
      direction !== undefined &&
      !["credit", "debit"].includes(direction)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction direction",
      });
    }

    const startDate = req.query.start_date;
    const endDate = req.query.end_date;

    if (startDate !== undefined && !isValidDate(startDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid start_date",
      });
    }

    if (endDate !== undefined && !isValidDate(endDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid end_date",
      });
    }

    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: "start_date must be before or equal to end_date",
      });
    }

    const result = await accountService.getTransactionsByAccount({
      accountUuid,
      page,
      limit,
      search,
      kind,
      direction,
      start_date: startDate,
      end_date: endDate,
    });

    return res.status(200).json({
      success: true,
      message: "Account transactions fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createAccount,
  updateAccount,
  getAccountById,
  getAccounts,
  getAccountBalances,
  getTransactionsByAccount,
};
