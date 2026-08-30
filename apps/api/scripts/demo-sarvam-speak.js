const { resolve } = require("node:path");
const { config } = require("dotenv");
config({ path: resolve(__dirname, "../../../.env") });

const { sarvamSpeak } = require("../../../packages/trpc/server/services/sarvam");

async function main() {
  console.log(process.env.SARVAM_API_KEY ? "SARVAM_API_KEY loaded" : "SARVAM_API_KEY missing");
  const result = await sarvamSpeak("Tender Sathi readiness check.", "en-IN");
  console.log({
    ok: result.ok,
    notice: result.notice,
    audioChars: result.audio_base64 ? result.audio_base64.length : 0,
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
