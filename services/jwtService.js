const jwt = require("jsonwebtoken");
require("dotenv").config();

async function signJwt(payload) {
  try {
    const token = jwt.sign(payload, process.env.JWT_KEY, {
      expiresIn: "10d",
      issuer: "plotbackend",
      algorithm: "HS256",
    });

    return token;
  } catch (error) {
    console.log(error);
  }
}

async function verifyJwt(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_KEY, {
      issuer: "plotbackend",
      algorithms: ["HS256"],
    });

    return decoded;
  } catch (error) {
    console.log(error);
  }
}

module.exports = { signJwt, verifyJwt };
