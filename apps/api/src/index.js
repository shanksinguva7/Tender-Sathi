// @ts-nocheck
const { config } = require("dotenv");
const { resolve } = require("node:path");
const cors = require("cors");
const express = require("express");
const multer = require("multer");
const trpcExpress = require("@trpc/server/adapters/express");
const { createContext, serverRouter } = require("@repo/trpc/server");

config({ path: resolve(__dirname, "../../../.env") });

const app = express();
const upload = multer();
const port = Number(process.env.PORT ?? 4000);
const clientUrl = process.env.CLIENT_URL ?? "http://localhost:3000";

const webDir = resolve(__dirname, "../../web");

app.use(
  cors({
    origin: [clientUrl, `http://127.0.0.1:${port}`, "http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "healthy" });
});

app.post("/api/documents/digitise", upload.single("document"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Select a PDF or image document first." });
    return;
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      state: "offline",
      message: "Set SARVAM_API_KEY on the server to run document digitization.",
    });
    return;
  }

  res.json({
    state: "submitted",
    job_id: `pending-${Date.now()}`,
    provider: "sarvam",
    notice: "Digitize is wired as a REST upload. Swap this stub for the live Sarvam Document AI call.",
  });
});

app.use(
  "/trpc",
  trpcExpress.createExpressMiddleware({
    router: serverRouter,
    createContext,
  }),
);

app.use(express.static(webDir));
app.get("/", (_req, res) => {
  res.sendFile(resolve(webDir, "index.html"));
});

app.use((err, req, res, _next) => {
  console.error("Unhandled Express error", req.path, err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Tender Sathi UI + API: http://127.0.0.1:${port}`);
  console.log(`tRPC endpoint: http://127.0.0.1:${port}/trpc`);
});
