// @ts-nocheck
const { z } = require("zod");

const { publicProcedure, router } = require("../../trpc");

const sarvamRouter = router({
  translate: publicProcedure
    .input(
      z.object({
        text: z.string().min(1),
        target_language_code: z.string().default("en-IN"),
      }),
    )
    .mutation(async ({ input }) => {
      const apiKey = process.env.SARVAM_API_KEY;
      if (!apiKey) {
        return {
          translated_text: input.text,
          provider: "offline",
          notice: "Set SARVAM_API_KEY on the server to enable live translation.",
        };
      }

      try {
        const response = await fetch("https://api.sarvam.ai/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-subscription-key": apiKey,
          },
          body: JSON.stringify({
            input: input.text,
            source_language_code: "en-IN",
            target_language_code: input.target_language_code,
          }),
        });
        if (!response.ok) {
          throw new Error(`Sarvam HTTP ${response.status}`);
        }
        const body = await response.json();
        return {
          translated_text: body.translated_text ?? input.text,
          provider: "sarvam",
        };
      } catch (error) {
        return {
          translated_text: input.text,
          provider: "offline",
          notice: `Sarvam was unavailable: ${error instanceof Error ? error.name : "Error"}`,
        };
      }
    }),
});

module.exports = { sarvamRouter };
