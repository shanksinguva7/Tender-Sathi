// @ts-nocheck
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const CACHE_DIR = resolve(__dirname, "../../../../data/cache");
const SCRAPE_TIMEOUT_MS = 45_000;
const FALLBACK_MESSAGE =
  "Anakin could not open this tender page (timeout or blocked). Confirm eligibility, contacts, and deadlines on the official CPPP notice.";

function cachePath(kind, key) {
  const hash = createHash("sha256").update(String(key)).digest("hex").slice(0, 16);
  return resolve(CACHE_DIR, `${kind}-${hash}.json`);
}

function readCache(kind, key) {
  const file = cachePath(kind, key);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(kind, key, value) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(kind, key), JSON.stringify(value, null, 2), "utf8");
}

function extractContacts(text) {
  const source = text || "";
  const emails = [...new Set(source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])];
  const phones = [...new Set(source.match(/(?:\+91[\s-]?)?[6-9]\d{9}|\d{3,5}[\s-]\d{6,8}/g) ?? [])];
  const departmentMatch = source.match(
    /(?:department|organisation|organization|ministry|division|circle|unit)\s*[:\-]\s*([^\n]{4,80})/i,
  );
  return {
    emails: emails.slice(0, 5),
    phones: phones.slice(0, 5),
    department: departmentMatch?.[1]?.trim() || "",
  };
}

function describeError(error) {
  const name = error?.name || "Error";
  const message = error?.message || String(error);
  if (/timeout/i.test(name) || /timeout/i.test(message)) return "timeout";
  if (/blocked|forbidden|403|captcha|cloudflare/i.test(message)) return "blocked";
  if (/401|403|auth/i.test(message)) return "auth";
  return name;
}

function getAnakinClient() {
  const apiKey = process.env.ANAKIN_API_KEY;
  if (!apiKey) return null;
  const { Anakin } = require("@anakin-io/sdk");
  return new Anakin({
    apiKey,
    timeoutMs: 60_000,
    pollTimeoutMs: SCRAPE_TIMEOUT_MS,
  });
}

async function scrapeTenderPage(url, { forceFresh = false } = {}) {
  if (!forceFresh) {
    const cached = readCache("scrape", url);
    if (cached) return { ...cached, cached: true };
  }

  const client = getAnakinClient();
  if (!client) {
    return {
      ok: false,
      cached: false,
      url,
      source: "anakin",
      markdown: "",
      summary: "",
      contacts: extractContacts(""),
      error: "missing_key",
      fallbackMessage: "Set ANAKIN_API_KEY to scrape the official tender page with Anakin.io.",
    };
  }

  try {
    const doc = await client.scrape(url, {
      formats: ["markdown", "summary"],
      country: "in",
      useBrowser: true,
      pollTimeoutMs: SCRAPE_TIMEOUT_MS,
    });

    const markdown = doc.markdown || "";
    const summary = doc.summary || "";
    const result = {
      ok: doc.status === "completed" && Boolean(markdown || summary),
      cached: false,
      url: doc.url || url,
      source: "anakin",
      markdown,
      summary,
      contacts: extractContacts(`${summary}\n${markdown}`),
      anakinCached: Boolean(doc.cached),
      durationMs: doc.durationMs,
    };

    if (!result.ok) {
      result.error = doc.error || "empty_page";
      result.fallbackMessage = FALLBACK_MESSAGE;
    }

    writeCache("scrape", url, result);
    return result;
  } catch (error) {
    const reason = describeError(error);
    const result = {
      ok: false,
      cached: false,
      url,
      source: "anakin",
      markdown: "",
      summary: "",
      contacts: extractContacts(""),
      error: reason,
      fallbackMessage: FALLBACK_MESSAGE,
    };
    return result;
  }
}

async function searchContacts({ title, authority, url }, { forceFresh = false } = {}) {
  const prompt = [
    "India government tender contact department email phone",
    authority,
    title,
    "CPPP eprocure.gov.in",
  ]
    .filter(Boolean)
    .join(" ");
  const cacheKey = prompt;

  if (!forceFresh) {
    const cached = readCache("search", cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const client = getAnakinClient();
  if (!client) {
    return {
      ok: false,
      cached: false,
      source: "anakin-search",
      query: prompt,
      results: [],
      contacts: extractContacts(""),
      error: "missing_key",
      fallbackMessage: "Set ANAKIN_API_KEY to look up contact and department details.",
    };
  }

  try {
    const search = await client.search(prompt, { limit: 5 });
    const results = (search.results || []).map((item) => ({
      url: item.url,
      title: item.title || "",
      snippet: item.snippet || "",
    }));
    const blob = results.map((item) => `${item.title}\n${item.snippet}`).join("\n");
    const result = {
      ok: results.length > 0,
      cached: false,
      source: "anakin-search",
      query: prompt,
      results,
      contacts: extractContacts(blob),
    };
    writeCache("search", cacheKey, result);
    return result;
  } catch (error) {
    return {
      ok: false,
      cached: false,
      source: "anakin-search",
      query: prompt,
      results: [],
      contacts: extractContacts(""),
      error: describeError(error),
      fallbackMessage:
        "Anakin Search could not find contact or department details. Use the official tender page.",
    };
  }
}

function hasContactInfo(contacts) {
  return Boolean(contacts?.emails?.length || contacts?.phones?.length || contacts?.department);
}

async function ingestTenderPage({ url, title, authority, forceFresh = false }) {
  const scrape = await scrapeTenderPage(url, { forceFresh });
  let search = null;
  let usedFallback = false;

  if (!scrape.ok || !hasContactInfo(scrape.contacts)) {
    search = await searchContacts({ title, authority, url }, { forceFresh });
    usedFallback = true;
  }

  const contacts = hasContactInfo(scrape.contacts) ? scrape.contacts : search?.contacts || scrape.contacts;
  const excerpt = (scrape.summary || scrape.markdown || "").replace(/\s+/g, " ").trim().slice(0, 420);

  return {
    provider: "anakin.io",
    url,
    usedFallback,
    scrape,
    search,
    contacts,
    excerpt,
    message: scrape.ok
      ? usedFallback
        ? "Anakin scraped the tender page. Contact/department details came from Anakin Search."
        : "Anakin scraped the official tender page."
      : scrape.fallbackMessage || FALLBACK_MESSAGE,
  };
}

const PIPELINE_NOTE = `Where we used Anakin.io

Tender Sathi uses Anakin as the live-web layer before Sarvam reads the page.

1. URL Scraper — when a user opens a tender workspace, we call Anakin scrape() on the official CPPP tender URL (markdown + summary, India, browser render). That is the source text for eligibility, documents, and deadlines.
2. Search API fallback — if the page times out, is blocked, or has no contact/department fields, we call Anakin search() for the issuing authority and tender title, then pull emails, phones, and department names from the snippets.
3. Demo cache — scrape and search results are stored under data/cache so repeated demo runs reuse the same Anakin payload instead of spending credits again.
4. Fail-soft — timeout, auth, or blocked-page errors never crash the app. The workspace stays open with a fallback: confirm everything on the official CPPP notice.

Pipeline: catalog schema → Anakin scrape/search → Sarvam translate/digitise → JSON workspace.`;

module.exports = {
  scrapeTenderPage,
  searchContacts,
  ingestTenderPage,
  PIPELINE_NOTE,
  FALLBACK_MESSAGE,
};
