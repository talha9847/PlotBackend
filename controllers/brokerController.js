"use strict";

const brokerService = require("../services/brokerService");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const optionalString = (value) => {
  if (value == null || value === "") return null;
  return typeof value === "string" ? value.trim() || null : value;
};

const validOptionalString = (value, maxLength) =>
  value == null ||
  value === "" ||
  (typeof value === "string" && value.trim().length <= maxLength);

function validateBrokerNamePhone(body) {
  return (
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    body.name.trim().length <= 100 &&
    typeof body.phone === "string" &&
    body.phone.trim().length > 0 &&
    body.phone.trim().length <= 30
  );
}

// CREATE BROKER
async function createBroker(req, res, next) {
  try {
    const body = req.body || {};

    if (!validateBrokerNamePhone(body)) {
      return res.status(400).json({
        success: false,
        message: "Broker name and mobile number are required",
      });
    }

    const email = optionalString(body.email);

    if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required",
      });
    }

    const stringLimits = {
      alternate_phone: 30,
      city: 100,
      district: 100,
      state: 100,
      postal_code: 20,
      country_code: 2,
    };

    for (const [field, maxLength] of Object.entries(stringLimits)) {
      if (!validOptionalString(body[field], maxLength)) {
        return res.status(400).json({
          success: false,
          message: `Invalid ${field}`,
        });
      }
    }

    for (const field of ["address_line1", "address_line2", "notes"]) {
      if (body[field] != null && typeof body[field] !== "string") {
        return res.status(400).json({
          success: false,
          message: `Invalid ${field}`,
        });
      }
    }

    if (
      (body.address_line1?.length ?? 0) > 5000 ||
      (body.address_line2?.length ?? 0) > 5000 ||
      (body.notes?.length ?? 0) > 10000
    ) {
      return res.status(400).json({
        success: false,
        message: "Address or notes exceed the allowed length",
      });
    }

    const countryCode = (
      optionalString(body.country_code) || "IN"
    ).toUpperCase();

    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return res.status(400).json({
        success: false,
        message: "Country code must contain two letters",
      });
    }

    const broker = await brokerService.createBroker(
      {
        name: body.name.trim(),
        phone: body.phone.trim(),
        alternate_phone: optionalString(body.alternate_phone),
        email,
        address_line1: optionalString(body.address_line1),
        address_line2: optionalString(body.address_line2),
        city: optionalString(body.city),
        district: optionalString(body.district),
        state: optionalString(body.state),
        postal_code: optionalString(body.postal_code),
        country_code: countryCode,
        notes: optionalString(body.notes),
      },
      req.user?.id ?? null,
    );

    return res.status(201).json({
      success: true,
      message: "Broker created successfully",
      data: { broker },
    });
  } catch (error) {
    next(error);
  }
}

// GET ALL BROKERS
async function getBrokers(req, res, next) {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      sortBy = "created_at",
      sortOrder = "desc",
    } = req.query;

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    if (
      !Number.isSafeInteger(parsedPage) ||
      parsedPage < 1 ||
      !Number.isSafeInteger(parsedLimit) ||
      parsedLimit < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Page and limit must be positive integers",
      });
    }

    if (parsedLimit > 100) {
      return res.status(400).json({
        success: false,
        message: "Limit cannot exceed 100",
      });
    }

    if (
      typeof search !== "string" ||
      search.length > 200 ||
      typeof sortBy !== "string" ||
      typeof sortOrder !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid broker query parameters",
      });
    }

    const result = await brokerService.getBrokers({
      page: parsedPage,
      limit: parsedLimit,
      search: search.trim(),
      sortBy,
      sortOrder,
    });

    return res.status(200).json({
      success: true,
      message: "Brokers fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

// GET BROKER BY UUID
async function getBrokerByUuid(req, res, next) {
  try {
    const { uuid } = req.params;

    if (typeof uuid !== "string" || !UUID_REGEX.test(uuid)) {
      return res.status(400).json({
        success: false,
        message: "Invalid broker UUID",
      });
    }

    const broker = await brokerService.getBrokerByUuid(uuid);

    if (!broker) {
      return res.status(404).json({
        success: false,
        message: "Broker not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Broker fetched successfully",
      data: { broker },
    });
  } catch (error) {
    next(error);
  }
}

// UPDATE BROKER
async function updateBroker(req, res, next) {
  try {
    const { uuid } = req.params;
    const body = req.body || {};

    if (typeof uuid !== "string" || !UUID_REGEX.test(uuid)) {
      return res.status(400).json({
        success: false,
        message: "Invalid broker UUID",
      });
    }

    if (!validateBrokerNamePhone(body)) {
      return res.status(400).json({
        success: false,
        message: "Broker name and mobile number are required",
      });
    }

    const email = optionalString(body.email);

    if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required",
      });
    }

    const stringLimits = {
      alternate_phone: 30,
      city: 100,
      district: 100,
      state: 100,
      postal_code: 20,
      country_code: 2,
    };

    for (const [field, maxLength] of Object.entries(stringLimits)) {
      if (!validOptionalString(body[field], maxLength)) {
        return res.status(400).json({
          success: false,
          message: `Invalid ${field}`,
        });
      }
    }

    for (const field of ["address_line1", "address_line2", "notes"]) {
      if (body[field] != null && typeof body[field] !== "string") {
        return res.status(400).json({
          success: false,
          message: `Invalid ${field}`,
        });
      }
    }

    if (
      (body.address_line1?.length ?? 0) > 5000 ||
      (body.address_line2?.length ?? 0) > 5000 ||
      (body.notes?.length ?? 0) > 10000
    ) {
      return res.status(400).json({
        success: false,
        message: "Address or notes exceed the allowed length",
      });
    }

    const countryCode = (
      optionalString(body.country_code) || "IN"
    ).toUpperCase();

    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return res.status(400).json({
        success: false,
        message: "Country code must contain two letters",
      });
    }

    const broker = await brokerService.updateBrokerByUuid(
      uuid,
      {
        name: body.name.trim(),
        phone: body.phone.trim(),
        email,
        alternate_phone: optionalString(body.alternate_phone),
        address_line1: optionalString(body.address_line1),
        address_line2: optionalString(body.address_line2),
        city: optionalString(body.city),
        district: optionalString(body.district),
        state: optionalString(body.state),
        postal_code: optionalString(body.postal_code),
        country_code: countryCode,
        notes: optionalString(body.notes),
      },
      req.user?.id ?? null,
    );

    if (!broker) {
      return res.status(404).json({
        success: false,
        message: "Broker not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Broker updated successfully",
      data: { broker },
    });
  } catch (error) {
    next(error);
  }
}

async function getAllBrokers(req, res, next) {
  try {
    const brokers = await brokerService.getAllBrokers();

    return res.status(200).json({
      success: true,
      message: "Brokers fetched successfully",
      data: { brokers },
    });
  } catch (error) {
    next(error);
  }
}
module.exports = {
  createBroker,
  getBrokers,
  getBrokerByUuid,
  updateBroker,
  getAllBrokers,
};
