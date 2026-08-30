// @ts-nocheck
const { z } = require("zod");

const { sarvamSpeak, sarvamTranslate } = require("../../services/sarvam");
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
      try {
        return await sarvamTranslate(input.text, input.target_language_code);
      } catch (error) {
        return {
          translated_text: input.text,
          provider: "offline",
          notice: `Sarvam was unavailable: ${error instanceof Error ? error.message : "Error"}`,
        };
      }
    }),

  speak: publicProcedure
    .input(
      z.object({
        text: z.string().min(1),
        language: z.string().default("en-IN"),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await sarvamSpeak(input.text, input.language);
      } catch (error) {
        return {
          ok: false,
          audio_base64: "",
          notice: `Sarvam TTS unavailable: ${error instanceof Error ? error.message : "Error"}`,
        };
      }
    }),
});

module.exports = { sarvamRouter };
