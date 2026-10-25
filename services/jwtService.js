const jwt = require("jsonwebtoken");
require("dotenv").config();

async function signJwt(payload) {
  return jwt.sign(payload, process.env.JWT_KEY, {
    expiresIn: "10d",
    issuer: "plotbackend",
    algorithm: "HS256",
  });
}

async function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_KEY, {
    issuer: "plotbackend",
    algorithms: ["HS256"],
  });
}

module.exports = { signJwt, verifyJwt };
