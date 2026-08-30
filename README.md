# TenderSathi — Tender Readiness Checker

Paste one government tender link (or upload the notice PDF) and get a plain-language
submission checklist — eligibility, EMD, required documents, deadline, contact — in
your own language, with a spoken summary.

Built for small contractors and MSME owners who lose bids to a missed eligibility
line, not to a better price.

---

## Layout

```
apps/web                 UI (index.html, app.js, styles.css)
apps/api                 Express + tRPC (Anakin JS SDK path)
apps/api/python          Flask server (same pipeline, monorepo paths)
packages/trpc            JS routers: health, tenders, sarvam, anakin
data                     scraped CPPP listings, snapshots, Anakin cache
pipeline.py              orchestration + field extraction
schema.py                10-field checklist contract
services/anakin.py       Python Anakin scrape + search
services/sarvam.py       Document AI, translate, TTS
docs/anakin-pipeline.md  copy-paste text for the submission form
```

---

## Run it — Node (tRPC + Anakin SDK)

```bash
copy .env.example .env
pnpm install
pnpm --filter @repo/api start
```

Open <http://127.0.0.1:4000>. Raw Anakin (no UI): `node apps/api/scripts/demo-anakin.js`

## Run it — Python (Flask pipeline)

```bash
git clone https://github.com/shanksinguva7/Tender-Sathi.git
cd Tender-Sathi && python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe server.py
```

Open <http://127.0.0.1:5000>. On macOS/Linux use `.venv/bin/python` instead.

### Optional API keys

The app runs **without any keys** — it degrades to cached scrapes and English text,
and says so in the UI. Set these to light up the live paths:

```bash
export SARVAM_API_KEY=your_key    # Document AI, Translate, TTS
export ANAKIN_API_KEY=your_key    # live URL scrape + contact search
```

Or put them in `.env`. Check what's live: <http://127.0.0.1:5000/api/health>

---

## Try it

1. Open the app — 20 real active CPPP tenders load in the catalog.
2. Click any tender card, **or** paste a tender URL into the box at the top.
3. The checklist renders all 10 fields. Green = extracted from the notice.
   Amber = **not published in the scraped notice, confirm on the official page**.
4. Switch to हिंदी or ಕನ್ನಡ, then press the ⌁ button for the spoken summary.
5. The **Pipeline trace** panel shows which stage ran and which degraded.
6. The **Anakin.io** panel shows live scrape / search fallback + contacts.

Example input for judges:

```
https://eprocure.gov.in/cppp/latestactivetendersnew
```

…or click any card in the catalog (these carry real CPPP detail URLs).

---

## Architecture

```
tender URL ──► services/anakin.py + packages/trpc Anakin SDK ──┐
                                                               ├─► pipeline.run() ──► schema.TenderChecklist ──► frontend
tender PDF ──► services/sarvam.py ─────────────────────────────┘
                                                                 ├─► Sarvam Translate
                                                                 └─► Sarvam TTS (bulbul)
```

| File | Role |
|---|---|
| `schema.py` | The one shared contract. 10 fields, each with value + source + found flag. |
| `services/anakin.py` | URL scrape (live API → repo cache → direct fetch) + contact search. |
| `packages/trpc/server/services/anakin.js` | Same Anakin path via official `@anakin-io/sdk`. |
| `services/sarvam.py` | Document AI **with polling**, Translate (chunked), TTS. |
| `pipeline.py` | Orchestration + field extraction. Stage-isolated; never raises. |
| `server.py` | Flask HTTP surface. Every route returns a degraded payload, never a bare 500. |
| `apps/api` | Express + tRPC surface for the JS Anakin/Sarvam path. |

### Where Sarvam.ai is used
- **Document AI** — `services/sarvam.py:digitise()`, extracts fields from an uploaded
  PDF/scanned notice. Submits the job **and polls to completion** before returning.
- **Translate** — `services/sarvam.py:translate()`, converts the checklist summary to
  Hindi/Kannada. Chunks on sentence boundaries to stay under the input cap.
- **Text-to-Speech** — `services/sarvam.py:speak()`, `bulbul:v2`, returns base64 WAV
  the browser plays directly.

### Where Anakin.io is used
- **URL Scraper** — `services/anakin.py:scrape()` and JS `anakin.ingest` pull the tender
  page as markdown. Falls back through a local disk cache → the pre-scraped batch jobs
  committed in this repo → a direct fetch, so a demo run never dead-ends.
- **Search API** — `services/anakin.py:search_contact()` and JS Search fallback find the
  issuing department's public contact when the notice itself doesn't publish one.

Submission form copy: `docs/anakin-pipeline.md`.

---

## Error handling

Each pipeline stage is isolated. A stage that fails writes its reason into
`stages[]` and the run continues, so one dead service degrades the output instead
of killing it. The response always conforms to the schema — fields that could not
be extracted come back with `found: false` and a note telling the user to confirm
on the official page.

Worst case (unknown URL, no keys, no network) still returns a valid checklist with
every field flagged rather than an error screen.

---

## Known limitations

- **No live portal auth.** CPPP tender-detail URLs carry a session token; scraping one
  cold returns the page shell only. The committed batch scrapes in
  `tender-details-batch-*.md` / `data/tender-details-batch-*.md` show exactly this.
- **URL and PDF input only.** No GeM/state-portal crawling, no CAPTCHA solving.
- **Readiness check, not a filing tool.** It does not submit bids.
- **Guidance, not legal advice.** The official tender page stays the source of truth.
