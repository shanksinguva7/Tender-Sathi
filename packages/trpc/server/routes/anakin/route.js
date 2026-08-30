// @ts-nocheck
const { z } = require("zod");

const { ingestTenderPage, PIPELINE_NOTE } = require("../../services/anakin");
const { listingTenders } = require("../../services/catalog");
const { publicProcedure, router } = require("../../trpc");

const anakinRouter = router({
  ingest: publicProcedure
    .input(
      z.object({
        url: z.string().url().optional(),
        tenderId: z.string().optional(),
        title: z.string().optional(),
        authority: z.string().optional(),
        forceFresh: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      let url = input.url;
      let title = input.title || "";
      let authority = input.authority || "";

      if (!url && input.tenderId) {
        const tender = listingTenders().find((item) => item.id === input.tenderId);
        if (!tender) {
          return {
            provider: "anakin.io",
            ok: false,
            message: "Tender not found in the local catalog.",
          };
        }
        url = tender.source_url;
        title = title || tender.title;
        authority = authority || tender.authority;
      }

      if (!url) {
        return {
          provider: "anakin.io",
          ok: false,
          message: "Pass a tender URL or tenderId.",
        };
      }

      return ingestTenderPage({
        url,
        title,
        authority,
        forceFresh: Boolean(input.forceFresh),
      });
    }),

  pipelineNote: publicProcedure.query(async () => {
    return { text: PIPELINE_NOTE };
  }),
});

module.exports = { anakinRouter };
