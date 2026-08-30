# Tender Sathi

Tender readiness checker for the Central Public Procurement Portal. Monorepo layout follows the Corsair hackathon shape, in plain JavaScript: `apps/*` + `packages/*` + Turbo.

## Layout

```
apps/web                 existing UI (index.html, app.js, styles.css)
apps/api                 Express + tRPC
apps/api/python          original Flask server
packages/trpc            JS routers: health, tenders, sarvam, anakin
data                     scraped CPPP listings, snapshots, Anakin cache
docs/anakin-pipeline.md  copy-paste text for the submission form
```

## Setup

```bash
copy .env.example .env
pnpm install
pnpm dev
```

- Web: http://localhost:3000
- API / tRPC: http://127.0.0.1:4000/trpc
- Raw Anakin (no UI): `node apps/api/scripts/demo-anakin.js`

Put `SARVAM_API_KEY` and `ANAKIN_API_KEY` in `.env`. Do not commit `.env`.

Submission form ("where we used Anakin.io"): copy `docs/anakin-pipeline.md`.
