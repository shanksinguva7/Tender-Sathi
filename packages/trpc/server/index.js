// @ts-nocheck
const { router } = require("./trpc");
const { healthRouter } = require("./routes/health/route");
const { tendersRouter } = require("./routes/tenders/route");
const { sarvamRouter } = require("./routes/sarvam/route");
const { anakinRouter } = require("./routes/anakin/route");
const { createContext } = require("./context");

const serverRouter = router({
  health: healthRouter,
  tenders: tendersRouter,
  sarvam: sarvamRouter,
  anakin: anakinRouter,
});

module.exports = { serverRouter, createContext };
