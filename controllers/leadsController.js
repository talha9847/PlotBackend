const leadService = require("../services/leadService");

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

async function createLead(req, res, next) {
  try {
    const body = req.body || {};
    if (!body.brokerId || body.brokerId == 0) body.brokerId = 1;
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 100 ||
      typeof body.phone !== "string" ||
      !body.phone.trim() ||
      body.phone.trim().length > 30
    ) {
      return res.status(400).json({
        success: false,
        message: "Lead name and phone are required",
      });
    }

    const leadType = body.lead_type || "individual";

    if (!leadService.CUSTOMER_TYPES.includes(leadType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead type",
      });
    }

    const stringLimits = {
      alternate_phone: 30,
      email: 254,
      company_name: 200,
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
      body.address_line1?.length > 5000 ||
      body.address_line2?.length > 5000 ||
      body.notes?.length > 10000
    ) {
      return res.status(400).json({
        success: false,
        message: "Address or notes exceed the allowed length",
      });
    }

    const email = optionalString(body.email);

    if (email && (email.length > 254 || !EMAIL_REGEX.test(email))) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address",
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

    const lead = await leadService.createLead(
      {
        name: body.name.trim(),
        phone: body.phone.trim(),
        alternate_phone: optionalString(body.alternate_phone),
        email,
        brokerId: body.brokerId,
        lead_type: leadType,
        company_name: optionalString(body.company_name),
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
      message: "Lead created successfully",
      data: { lead },
    });
  } catch (error) {
    next(error);
  }
}

async function getLeads(req, res, next) {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      sortBy = "created_at",
      sortOrder = "desc",
      leadType = "",
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
      typeof sortOrder !== "string" ||
      typeof leadType !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead query parameters",
      });
    }

    if (leadType && !leadService.CUSTOMER_TYPES.includes(leadType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead type filter",
      });
    }

    const result = await leadService.getLeads({
      page: parsedPage,
      limit: parsedLimit,
      search: search.trim(),
      sortBy,
      sortOrder,
      leadType,
    });

    return res.status(200).json({
      success: true,
      message: "Leads fetched successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

async function getLeadByUuid(req, res, next) {
  try {
    const { uuid } = req.params;

    if (!UUID_REGEX.test(uuid)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead UUID",
      });
    }

    const lead = await leadService.getLeadByUuid(uuid);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Lead fetched successfully",
      data: { lead },
    });
  } catch (error) {
    next(error);
  }
}

const updateLead = async (req, res, next) => {
  try {
    const { uuid } = req.params;
    const {
      name,
      phone,
      email,
      lead_type,
      country_code,
      alternate_phone,
      company_name,
      address_line1,
      address_line2,
      city,
      district,
      state,
      postal_code,
      notes,
    } = req.body;

    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name and phone are required.",
      });
    }

    const lead = await leadService.updateLeadByUuid(
      uuid,
      {
        name: name.trim(),
        phone: phone.trim(),
        email: email?.trim() || null,
        lead_type: lead_type || "individual",
        country_code: country_code || "+91",
        alternate_phone: alternate_phone?.trim() || null,
        company_name: company_name?.trim() || null,
        address_line1: address_line1?.trim() || null,
        address_line2: address_line2?.trim() || null,
        city: city?.trim() || null,
        district: district?.trim() || null,
        state: state?.trim() || null,
        postal_code: postal_code?.trim() || null,
        notes: notes?.trim() || null,
      },
      req.user?.id,
    );

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Lead updated successfully.",
      data: lead,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createLead,
  getLeads,
  getLeadByUuid,
  updateLead,
};
