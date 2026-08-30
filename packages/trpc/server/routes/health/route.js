// @ts-nocheck
const { publicProcedure, router } = require("../../trpc");

const healthRouter = router({
  getHealth: publicProcedure.query(async () => {
    return { status: "healthy" };
  }),
});

module.exports = { healthRouter };
