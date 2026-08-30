// @ts-nocheck
const crypto = require("node:crypto");

async function createContext({ req, res }) {
  const headerId = req.headers["x-request-id"];
  const requestId =
    (typeof headerId === "string" && headerId.trim()) || crypto.randomUUID().slice(0, 12);
  res.setHeader("x-request-id", requestId);
  return { req, res, requestId };
}

module.exports = { createContext };
