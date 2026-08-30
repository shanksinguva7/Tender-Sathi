// @ts-nocheck
const { TRPCError } = require("@trpc/server");
const { z } = require("zod");

const { listingTenders, tenderWorkspace, writeSnapshot } = require("../../services/catalog");
const { publicProcedure, router } = require("../../trpc");

const tendersRouter = router({
  list: publicProcedure.query(async () => {
    return {
      tenders: listingTenders(),
      source: "https://eprocure.gov.in/cppp/latestactivetendersnew",
      updated_at: new Date().toISOString(),
    };
  }),

  getById: publicProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const tender = listingTenders().find((item) => item.id === input.id);
    if (!tender) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Tender not found" });
    }
    return tenderWorkspace(tender);
  }),

  refresh: publicProcedure.mutation(async () => {
    return {
      status: "refreshed",
      snapshot: writeSnapshot(),
    };
  }),
});

module.exports = { tendersRouter };
