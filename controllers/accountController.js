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

module.exports = {
  createAccount,
  updateAccount,
  getAccountById,
  getAccounts,
};
