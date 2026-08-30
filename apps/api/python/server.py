from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
import truststore

truststore.inject_into_ssl()

ROOT = Path(__file__).resolve().parents[3]
WEB_DIR = ROOT / "apps" / "web"
DATA_DIR = ROOT / "data"
SNAPSHOT_FILE = DATA_DIR / "cppp-snapshot.json"
LISTING_FILES = [DATA_DIR / "active-tenders.md", DATA_DIR / "active-tenders-page-2.md", DATA_DIR / "active-tenders-page-3.md"]
CPP_URL = "https://eprocure.gov.in/cppp/latestactivetendersnew"
DETAIL_PATTERN = re.compile(r'\[([^\]]+)\]\((https://eprocure\.gov\.in/cppp/tendersfullview/[^\s)]+)\s+"External Url"\)/([^/\r\n]+)/([^\r\n]+?)(?=--\d+\.|\r?\n\r?\n|$)')

app = Flask(__name__)


def listing_tenders() -> list[dict[str, str]]:
    tenders: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for listing_file in LISTING_FILES:
        if not listing_file.exists():
            continue
        for match in DETAIL_PATTERN.finditer(listing_file.read_text(encoding="utf-8")):
            title, url, tender_id, tail = match.groups()
            if url in seen_urls:
                continue
            seen_urls.add(url)
            id_candidates = re.findall(r"\d{5,}", f"{tender_id} {tail}")
            normalized_id = max(id_candidates, key=len) if id_candidates else f"CPPP-{len(tenders) + 1}"
            authority = re.sub(r"^.*?\d{5,}", "", tail).strip() or "Central Government organisation"
            tenders.append({"id": normalized_id, "title": title.replace("\\_", "_"), "authority": authority, "source": "Central Public Procurement Portal (CPPP)", "source_url": url, "listing_url": CPP_URL, "source_status": "listing verified"})
    return tenders[:20]


def tender_workspace(tender: dict[str, str]) -> dict[str, object]:
    return {
        **tender,
        "summary": "This tender is listed as active on the Central Public Procurement Portal. Use the official tender page as the source of truth for all eligibility, financial, technical, document, and deadline requirements.",
        "requirements": [
            {"label": "Read the official tender notice", "source": "CPPP listing"},
            {"label": "Confirm eligibility and prequalification criteria", "source": "Official notice required"},
            {"label": "Confirm EMD, bid security, and fee conditions", "source": "Official notice required"},
            {"label": "Collect declarations, registrations, and annexures", "source": "Official documents required"},
            {"label": "Confirm bid submission and opening deadlines", "source": "Official notice required"},
        ],
        "documents": [
            {"name": "Tender notice", "state": "Open from official portal", "url": tender["source_url"]},
            {"name": "Technical specification / scope", "state": "Awaiting document extraction", "url": tender["source_url"]},
            {"name": "BOQ / commercial schedule", "state": "Awaiting document extraction", "url": tender["source_url"]},
            {"name": "Corrigendum / amendment notices", "state": "Watch on official portal", "url": tender["source_url"]},
        ],
        "response_outline": ["1. Understanding of requirement and scope", "2. Technical approach and delivery plan", "3. Relevant experience, personnel, and credentials", "4. Compliance matrix against official requirements", "5. Commercial response, declarations, and annexures"],
        "change_watch": {"state": "watching", "message": "No amendment comparison is available yet. Refresh the source listing and add official tender documents to enable a document-level comparison."},
    }


def write_snapshot() -> dict[str, object]:
    DATA_DIR.mkdir(exist_ok=True)
    current_items = [{"id": item["id"], "url": item["source_url"], "title": item["title"]} for item in listing_tenders()]
    current = {"captured_at": datetime.now(UTC).isoformat(), "hash": hashlib.sha256(json.dumps(current_items, sort_keys=True).encode()).hexdigest(), "items": current_items}
    previous = json.loads(SNAPSHOT_FILE.read_text()) if SNAPSHOT_FILE.exists() else None
    SNAPSHOT_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")
    previous_urls = {item["url"] for item in previous["items"]} if previous else set()
    current_urls = {item["url"] for item in current_items}
    return {"captured_at": current["captured_at"], "changed": previous is not None and current["hash"] != previous["hash"], "new_tenders": len(current_urls - previous_urls), "removed_tenders": len(previous_urls - current_urls)}


def sarvam_client():
    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        return None
    from sarvamai import SarvamAI

    return SarvamAI(api_subscription_key=api_key)


@app.get("/")
def home():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/<path:asset>")
def static_asset(asset: str):
    if asset not in {"app.js", "styles.css"}:
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(WEB_DIR, asset)


@app.get("/api/tenders")
def get_tenders():
    return jsonify({"tenders": listing_tenders(), "source": CPP_URL, "updated_at": datetime.now(UTC).isoformat()})


@app.get("/api/tenders/<tender_id>")
def get_tender(tender_id: str):
    tender = next((item for item in listing_tenders() if item["id"] == tender_id), None)
    if tender is None:
        return jsonify({"error": "Tender not found"}), 404
    return jsonify(tender_workspace(tender))


@app.post("/api/translate")
def translate():
    body = request.get_json(silent=True) or {}
    text = str(body.get("text", "")).strip()
    target = str(body.get("target_language_code", "en-IN"))
    if not text:
        return jsonify({"error": "Text is required"}), 400
    client = sarvam_client()
    if client is None:
        return jsonify({"translated_text": text, "provider": "offline", "notice": "Set SARVAM_API_KEY on the server to enable live translation."})
    try:
        result = client.text.translate(input=text, source_language_code="en-IN", target_language_code=target)
        return jsonify({"translated_text": result.translated_text, "provider": "sarvam"})
    except Exception as error:
        return jsonify({"translated_text": text, "provider": "offline", "notice": f"Sarvam was unavailable: {type(error).__name__}"})


@app.post("/api/documents/digitise")
def digitise_document():
    uploaded = request.files.get("document")
    if uploaded is None or not uploaded.filename:
        return jsonify({"error": "Select a PDF or image document first."}), 400
    client = sarvam_client()
    if client is None:
        return jsonify({"state": "offline", "message": "Set SARVAM_API_KEY on the server to run document digitization."}), 503
    try:
        job = client.doc_ai.digitise(file=[(uploaded.filename, uploaded.stream, uploaded.mimetype)], language="en-IN", output_format="md", content_type="printed")
        return jsonify({"state": "submitted", "job_id": job.job_id, "provider": "sarvam"})
    except Exception as error:
        return jsonify({"state": "failed", "message": f"Sarvam document digitization failed: {type(error).__name__}"}), 502


@app.post("/api/refresh")
def refresh_catalog():
    anakin = ROOT / ".venv" / "Scripts" / "anakin.exe"
    if not anakin.exists():
        return jsonify({"error": "Anakin CLI is not installed in .venv."}), 503
    try:
        subprocess.run([str(anakin), "scrape", CPP_URL, "-o", str(LISTING_FILES[0])], cwd=ROOT, text=True, capture_output=True, timeout=180, check=True)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        return jsonify({"error": "Anakin refresh failed.", "detail": str(error)}), 502
    return jsonify({"status": "refreshed", "snapshot": write_snapshot()})


if __name__ == "__main__":
    write_snapshot()
    app.run(host="127.0.0.1", port=5000, debug=True)