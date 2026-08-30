"""Tender Readiness Checker - HTTP surface over the orchestration pipeline.

Every route is wrapped so a service failure returns a degraded payload with a
readable message instead of a 500. The pipeline itself never raises.
"""
from __future__ import annotations

import os
import traceback
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(ROOT / ".env")

from flask import Flask, jsonify, request, send_file, send_from_directory

try:  # optional: only needed for corporate TLS interception
    import truststore

    truststore.inject_into_ssl()
except Exception:
    pass

import attachments
import export_docx
import pipeline
from services import sarvam

WEB_DIR = ROOT / "apps" / "web"
if not (WEB_DIR / "index.html").exists():
    WEB_DIR = ROOT
CPP_URL = "https://eprocure.gov.in/cppp/latestactivetendersnew"
STATIC_ASSETS = {"app.js", "styles.css"}

app = Flask(__name__)
# Keep the checklist in schema order instead of alphabetising the field keys.
app.json.sort_keys = False


@app.errorhandler(Exception)
def handle_unexpected(error):
    """Top-level net: nothing escapes as an unstyled 500."""
    app.logger.error("Unhandled error: %s", traceback.format_exc())
    return jsonify({"error": "Something failed on the server.", "detail": type(error).__name__}), 500


@app.get("/")
def home():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/<path:asset>")
def static_asset(asset: str):
    if asset not in STATIC_ASSETS:
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(WEB_DIR, asset)


@app.get("/api/tenders")
def get_tenders():
    """Demo affordance - real CPPP tenders a judge can click instead of pasting."""
    return jsonify({
        "tenders": pipeline.catalog(),
        "source": CPP_URL,
        "updated_at": datetime.now(UTC).isoformat(),
    })


@app.post("/api/check")
def check_tender():
    """THE endpoint: one tender URL -> full readiness checklist."""
    body = request.get_json(silent=True) or {}
    url = str(body.get("url", "")).strip()
    if not url:
        return jsonify({"error": "Paste a tender URL first."}), 400
    if not url.startswith(("http://", "https://")):
        return jsonify({"error": "That does not look like a tender URL."}), 400
    return jsonify(pipeline.run("url", url))


@app.post("/api/check/sample")
def check_sample():
    """Bundled sample notice through the same extractor - guarantees a live demo."""
    return jsonify(pipeline.run("sample", "samples/sample-tender-notice.txt"))


@app.post("/api/check/document")
def check_document():
    """Same checklist, from an uploaded PDF via Sarvam Document AI."""
    uploaded = request.files.get("document")
    if uploaded is None or not uploaded.filename:
        return jsonify({"error": "Select a PDF or image of the tender notice first."}), 400

    # Keep the pages so the Word export can show what the fields were read from.
    stored = attachments.store(uploaded)
    result = pipeline.run("pdf", uploaded.filename, uploaded=uploaded, attachment_token=stored["token"])
    result["attachment_token"] = stored["token"]
    result["stages"]["attachments"] = {"ok": stored["ok"], "detail": stored["detail"]}
    return jsonify(result)


@app.post("/api/translate")
def translate():
    body = request.get_json(silent=True) or {}
    text = str(body.get("text", "")).strip()
    target = str(body.get("target_language_code", "en-IN"))
    if not text:
        return jsonify({"error": "Text is required"}), 400
    result = sarvam.translate(text, target)
    return jsonify({
        "translated_text": result["text"],
        "provider": "sarvam" if result["ok"] and target != "en-IN" else "offline",
        "notice": result["detail"],
    })


@app.post("/api/speak")
def speak():
    """Sarvam bulbul TTS. Frontend falls back to the browser voice if this fails."""
    body = request.get_json(silent=True) or {}
    text = str(body.get("text", "")).strip()
    language = str(body.get("language", "en-IN"))
    if not text:
        return jsonify({"error": "Text is required"}), 400
    result = sarvam.speak(text, language)
    return jsonify({
        "ok": result["ok"],
        "audio_base64": result["audio_base64"],
        "notice": result["detail"],
    })


@app.post("/api/export")
def export_word():
    """Download the checklist as a .docx - opens in Word, Google Docs, LibreOffice."""
    body = request.get_json(silent=True) or {}
    checklist = body.get("checklist")
    if not isinstance(checklist, dict) or "fields" not in checklist:
        return jsonify({"error": "Run a readiness check before exporting."}), 400

    pages = attachments.pages(str(body.get("attachment_token", "")))
    try:
        stream = export_docx.build(
            checklist,
            attachments=pages,
            summary_override=str(body.get("summary", "")),
            language_label=str(body.get("language_label", "English")),
        )
    except Exception as error:
        app.logger.error("Export failed: %s", traceback.format_exc())
        return jsonify({"error": "Could not build the Word summary.", "detail": type(error).__name__}), 500

    return send_file(
        stream,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name=export_docx.filename_for(checklist),
    )


@app.get("/api/health")
def health():
    """Shows at a glance which integrations are live - useful during the demo."""
    return jsonify({
        "schema_version": pipeline.TenderChecklist.blank("url", "").schema_version,
        "catalog_tenders": len(pipeline.catalog()),
        "sarvam_key": bool(os.environ.get("SARVAM_API_KEY")),
        "anakin_key": bool(os.environ.get("ANAKIN_API_KEY") or os.environ.get("ANAKIN_API_TOKEN")),
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
