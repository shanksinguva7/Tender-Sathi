// @ts-nocheck
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const CPP_URL = "https://eprocure.gov.in/cppp/latestactivetendersnew";
const DETAIL_PATTERN =
  /\[([^\]]+)\]\((https:\/\/eprocure\.gov\.in\/cppp\/tendersfullview\/[^\s)]+)\s+"External Url"\)\/([^/\r\n]+)\/([^\r\n]+?)(?=--\d+\.|\r?\n\r?\n|$)/g;

function repoRoot() {
  return resolve(__dirname, "../../../../");
}

function listingFiles() {
  const dataDir = resolve(repoRoot(), "data");
  return [
    resolve(dataDir, "active-tenders.md"),
    resolve(dataDir, "active-tenders-page-2.md"),
    resolve(dataDir, "active-tenders-page-3.md"),
  ];
}

function listingTenders() {
  const tenders = [];
  const seenUrls = new Set();

  for (const listingFile of listingFiles()) {
    if (!existsSync(listingFile)) continue;
    const text = readFileSync(listingFile, "utf8");
    for (const match of text.matchAll(DETAIL_PATTERN)) {
      const title = match[1] ?? "";
      const url = match[2] ?? "";
      const tenderId = match[3] ?? "";
      const tail = match[4] ?? "";
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      const idCandidates = `${tenderId} ${tail}`.match(/\d{5,}/g) ?? [];
      const normalizedId =
        idCandidates.sort((left, right) => right.length - left.length)[0] ??
        `CPPP-${tenders.length + 1}`;
      const authority =
        tail.replace(/^.*?\d{5,}/, "").trim() || "Central Government organisation";

      tenders.push({
        id: normalizedId,
        title: title.replace(/\\_/g, "_"),
        authority,
        source: "Central Public Procurement Portal (CPPP)",
        source_url: url,
        listing_url: CPP_URL,
        source_status: "listing verified",
      });
    }
  }

  return tenders.slice(0, 20);
}

function tenderWorkspace(tender) {
  return {
    ...tender,
    summary:
      "This tender is listed as active on the Central Public Procurement Portal. Use the official tender page as the source of truth for all eligibility, financial, technical, document, and deadline requirements.",
    requirements: [
      { label: "Read the official tender notice", source: "CPPP listing" },
      { label: "Confirm eligibility and prequalification criteria", source: "Official notice required" },
      { label: "Confirm EMD, bid security, and fee conditions", source: "Official notice required" },
      { label: "Collect declarations, registrations, and annexures", source: "Official documents required" },
      { label: "Confirm bid submission and opening deadlines", source: "Official notice required" },
    ],
    documents: [
      { name: "Tender notice", state: "Open from official portal", url: tender.source_url },
      { name: "Technical specification / scope", state: "Awaiting document extraction", url: tender.source_url },
      { name: "BOQ / commercial schedule", state: "Awaiting document extraction", url: tender.source_url },
      { name: "Corrigendum / amendment notices", state: "Watch on official portal", url: tender.source_url },
    ],
    response_outline: [
      "1. Understanding of requirement and scope",
      "2. Technical approach and delivery plan",
      "3. Relevant experience, personnel, and credentials",
      "4. Compliance matrix against official requirements",
      "5. Commercial response, declarations, and annexures",
    ],
    change_watch: {
      state: "watching",
      message:
        "No amendment comparison is available yet. Refresh the source listing and add official tender documents to enable a document-level comparison.",
    },
  };
}

function writeSnapshot() {
  const dataDir = resolve(repoRoot(), "data");
  mkdirSync(dataDir, { recursive: true });
  const snapshotFile = resolve(dataDir, "cppp-snapshot.json");
  const currentItems = listingTenders().map((item) => ({
    id: item.id,
    url: item.source_url,
    title: item.title,
  }));
  const current = {
    captured_at: new Date().toISOString(),
    hash: createHash("sha256").update(JSON.stringify(currentItems)).digest("hex"),
    items: currentItems,
  };

  let previous = null;
  if (existsSync(snapshotFile)) {
    previous = JSON.parse(readFileSync(snapshotFile, "utf8"));
  }

  writeFileSync(snapshotFile, JSON.stringify(current, null, 2), "utf8");
  const previousUrls = new Set((previous?.items ?? []).map((item) => item.url));
  const currentUrls = new Set(currentItems.map((item) => item.url));

  return {
    captured_at: current.captured_at,
    changed: previous !== null && current.hash !== previous.hash,
    new_tenders: [...currentUrls].filter((url) => !previousUrls.has(url)).length,
    removed_tenders: [...previousUrls].filter((url) => !currentUrls.has(url)).length,
  };
}

module.exports = { listingTenders, tenderWorkspace, writeSnapshot };
