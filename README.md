# TenderSathi — Tender Readiness Checker

Paste one government tender link (or upload the notice PDF) and get a plain-language
submission checklist — eligibility, EMD, required documents, deadline, contact — in
your own language, with a spoken summary.

Built for small contractors and MSME owners who lose bids to a missed eligibility
line, not to a better price.

---

## Run it locally

```bash
git clone https://github.com/shanksinguva7/Tender-Sathi.git
```

```bash
cd Tender-Sathi && python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt
```

```bash
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

Check what's live at any time: <http://127.0.0.1:5000/api/health>

---

## Try it

1. Open the app — 20 real active CPPP tenders load in the catalog.
2. Click any tender card, **or** paste a tender URL into the box at the top.
3. The checklist renders all 10 fields. Green = extracted from the notice.
   Amber = **not published in the scraped notice, confirm on the official page**.
4. Switch to हिंदी or ಕನ್ನಡ, then press the ⌁ button for the spoken summary.
5. The **Pipeline trace** panel shows which stage ran and which degraded.
6. Press **Download Word summary** for a `.docx` of everything above.

Example input for judges:

```
https://eprocure.gov.in/cppp/latestactivetendersnew
```

…or click any card in the catalog (these carry real CPPP detail URLs).

---

## Architecture

```
tender URL ──► services/anakin.py ──┐
                                    ├─► pipeline.run() ──► schema.TenderChecklist ──► frontend
tender PDF ──► services/sarvam.py ──┘                            │
                                                                 ├─► Sarvam Translate
                                                                 └─► Sarvam TTS (bulbul)
```

| File | Role |
|---|---|
| `schema.py` | The one shared contract. 10 fields, each with value + source + found flag. |
| `services/anakin.py` | URL scrape (live API → repo cache → direct fetch) + contact search. |
| `services/sarvam.py` | Document AI **with polling**, Translate (chunked), TTS. |
| `pipeline.py` | Orchestration + field extraction. Stage-isolated; never raises. |
| `attachments.py` | Stores uploads, renders PDF pages to PNG, reads the PDF text layer. |
| `export_docx.py` | Builds the downloadable Word summary with `python-docx`. |
| `server.py` | HTTP surface. Every route returns a degraded payload, never a bare 500. |

### Where Sarvam.ai is used
- **Document AI** — `services/sarvam.py:digitise()`, extracts fields from an uploaded
  PDF/scanned notice. Submits the job **and polls to completion** before returning.
- **Translate** — `services/sarvam.py:translate()`, converts the checklist summary to
  Hindi/Kannada. Chunks on sentence boundaries to stay under the input cap.
- **Text-to-Speech** — `services/sarvam.py:speak()`, `bulbul:v2`, returns base64 WAV
  the browser plays directly.

### Where Anakin.io is used
- **URL Scraper** — `services/anakin.py:scrape()`, pulls the tender page as markdown.
  Falls back through a local disk cache → the pre-scraped batch jobs committed in this
  repo → a direct fetch, so a demo run never dead-ends.
- **Search API** — `services/anakin.py:search_contact()`, finds the issuing department's
  public contact page when the notice itself doesn't publish one.

---

## Word / Google Docs export

**Download Word summary** builds a `.docx` containing the plain-language summary
(in whichever language is selected), a full requirements table with the source of
every extracted value, a **Before you bid** section listing everything that could
not be extracted, and — when the input was an uploaded file — an image of every
page the fields were read from.

Built with `python-docx` into an in-memory buffer and streamed back by Flask, so
nothing is written to disk and no data leaves the machine. The file opens natively
in **Google Docs** (drag into Drive, or File - Open), Word, and LibreOffice.

There is deliberately no Google Docs API integration: it would require OAuth, a
Google Cloud project, and pushing tender data to a third party, for a file the
user can open in Docs anyway.

### PDF input without an API key

Uploaded PDFs are read twice. Sarvam Document AI handles scanned notices. If no
`SARVAM_API_KEY` is set — or the call fails — the pipeline falls back to the PDF's
own text layer via PyMuPDF, which fills the whole checklist for any digitally
generated notice. A genuinely scanned PDF has no text layer and still needs Sarvam;
the trace panel says so explicitly rather than returning an empty checklist.

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
  `tender-details-batch-*.md` show exactly this — all 20 came back as header markup
  with no tender fields. Catalog-level data (title, ID, authority) is real and parsed
  from the committed listings.
- **URL and PDF input only.** No GeM/state-portal crawling, no CAPTCHA solving.
- **Readiness check, not a filing tool.** It does not submit bids.
- **Guidance, not legal advice.** The official tender page stays the source of truth.
