const accountService = require("../services/accountService");

async function createAccount(req, res, next) {
  try {
    const { account_name, bank_name } = req.body || {};

    if (
      typeof account_name !== "string" ||
      typeof bank_name !== "string" ||
      !account_name.trim() ||
      !bank_name.trim() ||
      account_name.trim().length > 100 ||
      bank_name.trim().length > 100
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid account name and bank name are required (maximum 100 characters each)",
      });
    }

    const account = await accountService.createAccount({
      account_name: account_name.trim(),
      bank_name: bank_name.trim(),
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
    const { account_name, bank_name } = req.body || {};

    if (!/^[1-9]\d*$/.test(accountId)) {
      return res.status(400).json({
        success: false,
        message: "Valid account ID is required",
      });
    }

    if (
      typeof account_name !== "string" ||
      typeof bank_name !== "string" ||
      !account_name.trim() ||
      !bank_name.trim() ||
      account_name.trim().length > 100 ||
      bank_name.trim().length > 100
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid account name and bank name are required (maximum 100 characters each)",
      });
    }

    const account = await accountService.updateAccount(accountId, {
      account_name: account_name.trim(),
      bank_name: bank_name.trim(),
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

    const result = await accountService.getTransactionsByAccount({
      accountUuid,
      page,
      limit,
      search,
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
  getTransactionsByAccount,
};
