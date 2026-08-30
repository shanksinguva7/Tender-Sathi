// Prints raw Anakin output (no UI). Usage: node apps/api/scripts/demo-anakin.js [tenderId]
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../../.env") });

const { listingTenders } = require("../../../packages/trpc/server/services/catalog");
const { ingestTenderPage, PIPELINE_NOTE } = require("../../../packages/trpc/server/services/anakin");

async function main() {
  const tenders = listingTenders();
  const tender = tenders.find((item) => item.id === process.argv[2]) || tenders[0];
  if (!tender) {
    console.error("No tenders in data/*.md");
    process.exit(1);
  }

  console.log("=== Anakin pipeline note ===\n");
  console.log(PIPELINE_NOTE);
  console.log("\n=== Ingest", tender.id, "===\n");
  const result = await ingestTenderPage({
    url: tender.source_url,
    title: tender.title,
    authority: tender.authority,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
