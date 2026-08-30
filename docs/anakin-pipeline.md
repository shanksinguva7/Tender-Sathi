# Where we used Anakin.io

Tender Sathi uses **Anakin.io** as the live-web layer before Sarvam reads the page.

## Pipeline

`catalog schema → Anakin scrape / search → Sarvam translate / digitise → JSON workspace`

1. **URL Scraper** — Opening a tender workspace calls Anakin `scrape()` on the official CPPP tender URL (`markdown` + `summary`, country `in`, browser render). That is the source text for eligibility, documents, and deadlines.
2. **Search API fallback** — If the page times out, is blocked, or has no contact/department fields, we call Anakin `search()` for the issuing authority + tender title, then extract emails, phones, and department names from the snippets.
3. **Demo cache** — Scrape and search payloads are stored in `data/cache` so repeated demo runs reuse the same Anakin result instead of re-hitting the API.
4. **Fail-soft** — Timeout, auth, or blocked-page errors never crash the app. The workspace stays open with: confirm everything on the official CPPP notice.

## Code

- SDK: `@anakin-io/sdk` (`ANAKIN_API_KEY` in `.env`)
- Service: `packages/trpc/server/services/anakin.js`
- Procedure: `anakin.ingest` / `anakin.pipelineNote`

Copy the first section into the hackathon submission form field **"where we used Anakin.io"**.
