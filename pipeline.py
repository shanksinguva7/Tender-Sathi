"""End-to-end orchestration: input -> Anakin -> Sarvam -> TenderChecklist.

Task 2 + 3 (Shashank). Every stage is isolated: a stage that fails records its
failure in `stages` and the pipeline keeps going, so one dead service can never
take down the whole run. The output always conforms to schema.TenderChecklist.
"""
from __future__ import annotations

import re
from pathlib import Path

from schema import LIST_FIELDS, TenderChecklist
from services import anakin, sarvam

ROOT = Path(__file__).parent
LISTING_FILES = [
    ROOT / "active-tenders.md",
    ROOT / "active-tenders-page-2.md",
    ROOT / "active-tenders-page-3.md",
]
LISTING_PATTERN = re.compile(
    r"\[([^\]]+)\]\((https://eprocure\.gov\.in/cppp/tendersfullview/[^\s)]+)\s+"
    r"\"External Url\"\)/([^/\r\n]+)/([^\r\n]+?)(?=--\d+\.|\r?\n\r?\n|$)"
)

# CPPP detail pages label their fields; match label -> value across md/html text.
LABEL_PATTERNS = {
    "tender_title": [
        r"(?:Tender\s*Title|Work\s*Description|Name\s*of\s*Work|Title\s*of\s*Tender)\s*[:\-|]\s*([^\n|<]{5,200})",
    ],
    "tender_id": [
        r"Tender\s*(?:Reference\s*)?(?:ID|No\.?|Number)\s*[:\-|]\s*([^\n|<]{3,80})",
    ],
    "issuing_authority": [
        r"Organisation\s*(?:Name|Chain)\s*[:\-|]\s*([^\n|<]{3,120})",
        r"Department\s*Name\s*[:\-|]\s*([^\n|<]{3,120})",
    ],
    "emd_amount": [
        r"EMD\s*Amount(?:\s*in\s*[^:|\-]{0,15})?\s*[:\-|]\s*([^\n|<]{1,60})",
        r"Bid\s*Security\s*[:\-|]\s*([^\n|<]{1,60})",
    ],
    "tender_fee": [
        r"Tender\s*Fee(?:\s*in\s*[^:|\-]{0,15})?\s*[:\-|]\s*([^\n|<]{1,60})",
        r"Document\s*Cost\s*[:\-|]\s*([^\n|<]{1,60})",
    ],
    "submission_deadline": [
        r"Bid\s*Submission\s*(?:End\s*Date|Closing\s*Date)\s*[:\-|]\s*([^\n|<]{4,60})",
        r"Last\s*Date\s*(?:of|for)\s*Submission\s*[:\-|]\s*([^\n|<]{4,60})",
    ],
    "opening_date": [
        r"Bid\s*Opening\s*Date\s*[:\-|]\s*([^\n|<]{4,60})",
        r"Tender\s*Opening\s*Date\s*[:\-|]\s*([^\n|<]{4,60})",
    ],
    "contact": [
        r"(?:Nodal|Tender\s*Inviting)\s*(?:Officer|Authority)\s*(?:Name)?\s*[:\-|]\s*([^\n|<]{3,120})",
        r"Contact\s*(?:Person|Details|Name)\s*[:\-|]\s*([^\n|<]{3,120})",
        r"([\w.\-]+@[\w.\-]+\.[a-z]{2,})",
    ],
    "eligibility": [
        r"(?:Pre\s*Qualification|Eligibility)[^:\n]{0,30}[:\-|]\s*([^\n|<]{10,400})",
    ],
}
# Case-sensitive on the acronyms so "ESI" does not match inside ordinary words.
DOCUMENT_PATTERN = re.compile(
    r"\b(?:NIT|BOQ|EPF|ESI|PAN\s*Card|GSTIN"
    r"|(?i:Tender\s*Document|Bill\s*of\s*Quantit\w+|Technical\s*Bid|Financial\s*Bid"
    r"|Corrigendum|Annexure|Affidavit|GST\s*(?:Registration|Certificate)"
    r"|MSME\s*Certificate|Experience\s*Certificate|Solvency\s*Certificate"
    r"|Power\s*of\s*Attorney|Turnover\s*Certificate))\b"
)


ACRONYMS = {"NIT", "BOQ", "EPF", "ESI", "GST", "GSTIN", "PAN", "MSME"}


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[|*_>#]+", " ", value)).strip(" .:-")


def _title_case(name: str) -> str:
    """Title-case a document name but leave acronyms like BOQ and GST alone."""
    return " ".join(
        word.upper() if word.upper() in ACRONYMS else word.capitalize()
        for word in _clean(name).split()
    )


def listing_index() -> dict:
    """Real title/authority/id per detail URL, harvested from the CPPP listings."""
    index: dict = {}
    for listing_file in LISTING_FILES:
        if not listing_file.exists():
            continue
        try:
            text = listing_file.read_text(encoding="utf-8")
        except Exception:
            continue
        for title, url, tender_id, tail in LISTING_PATTERN.findall(text):
            if url in index:
                continue
            ids = re.findall(r"\d{5,}", tender_id + " " + tail)
            index[url] = {
                "title": _clean(title.replace("\\_", "_")),
                "id": max(ids, key=len) if ids else tender_id.strip(),
                "authority": _clean(re.sub(r"^.*?\d{5,}", "", tail)) or "Central Government organisation",
                "url": url,
            }
    return index


def catalog(limit: int = 20) -> list:
    """Demo affordance: real tenders the judge can click instead of pasting a URL."""
    return list(listing_index().values())[:limit]


def extract_fields(checklist: TenderChecklist, text: str, source: str, url: str) -> None:
    """Pull schema fields out of raw notice text. Absent fields stay unfound."""
    if not text.strip():
        return
    for key, patterns in LABEL_PATTERNS.items():
        for pattern in patterns:
            match = re.search(pattern, text, re.I)
            if not match:
                continue
            value = _clean(match.group(1))
            if len(value) < 2:
                continue
            checklist.set(key, [value] if key in LIST_FIELDS else value, source, url)
            break
    documents = sorted({_title_case(name) for name in DOCUMENT_PATTERN.findall(text)})
    if documents:
        checklist.set("required_documents", documents, source, url)


def build_summary(checklist: TenderChecklist) -> str:
    """Plain-language text that feeds Translate and TTS."""

    def get(key):
        entry = checklist.fields[key]
        return entry.value if entry.found else None

    lines = ["Tender: " + str(get("tender_title") or "title not published in the scraped notice") + "."]
    if get("issuing_authority"):
        lines.append("Issued by " + str(get("issuing_authority")) + ".")

    if get("emd_amount"):
        lines.append("Earnest money deposit is " + str(get("emd_amount")) + ".")
    else:
        lines.append("The EMD amount was not found in the notice, so confirm it on the official page before paying.")

    if get("submission_deadline"):
        lines.append("Bids must be submitted by " + str(get("submission_deadline")) + ".")
    else:
        lines.append("The submission deadline was not found, so check the official page immediately.")

    documents = get("required_documents")
    if documents:
        lines.append("Keep these documents ready: " + ", ".join(documents[:6]) + ".")
    else:
        lines.append("The document list was not published in the scraped notice.")

    if checklist.missing:
        lines.append(
            str(len(checklist.missing)) + " of " + str(len(checklist.fields))
            + " items are still missing and must be confirmed on the official tender page."
        )
    return " ".join(lines)


def run(input_type: str, input_ref: str, uploaded=None, attachment_token: str = "") -> dict:
    """The single orchestration entry point. Never raises."""
    checklist = TenderChecklist.blank(input_type, input_ref)

    # Stage 0 - listing enrichment (local, always available). Not relevant to PDFs
    # or the bundled sample, which carry their own fields.
    if input_type == "url":
        try:
            known = listing_index().get(input_ref)
            if known:
                checklist.set("tender_title", known["title"], "listing", known["url"])
                checklist.set("tender_id", known["id"], "listing", known["url"])
                checklist.set("issuing_authority", known["authority"], "listing", known["url"])
                checklist.stages["listing"] = {"ok": True, "detail": "matched the committed CPPP listing"}
            else:
                checklist.stages["listing"] = {"ok": False, "detail": "URL is not in the cached CPPP listing"}
        except Exception as error:
            checklist.stages["listing"] = {"ok": False, "detail": "listing lookup failed: " + type(error).__name__}

    # Sample path - a committed demo notice, run through the same real extractor.
    if input_type == "sample":
        sample = ROOT / "samples" / "sample-tender-notice.txt"
        try:
            extract_fields(checklist, sample.read_text(encoding="utf-8"), "sample-notice", "")
            checklist.stages["sample"] = {"ok": True, "detail": "sample notice parsed by the live extractor"}
            checklist.warnings.append("This is a sample notice bundled for the demo, not a live tender.")
        except Exception as error:
            checklist.stages["sample"] = {"ok": False, "detail": "sample unreadable: " + type(error).__name__}

    # Stage 1 - Anakin scrape (URL input).
    if input_type == "url":
        try:
            text, meta = anakin.scrape(input_ref)
            checklist.stages["anakin"] = {"ok": meta["ok"], "detail": meta["detail"]}
            if meta["ok"]:
                extract_fields(checklist, text, "anakin:" + str(meta["provider"]), input_ref)
            else:
                checklist.warnings.append("Scrape stage degraded - " + meta["detail"])
        except Exception as error:
            checklist.stages["anakin"] = {"ok": False, "detail": "scrape crashed: " + type(error).__name__}
            checklist.warnings.append("Scrape stage crashed; continuing with what is already known.")

    # Stage 2 - Sarvam Document AI (PDF input).
    if input_type == "pdf" and uploaded is not None:
        try:
            result = sarvam.digitise(uploaded.filename, uploaded.stream, uploaded.mimetype)
            checklist.stages["sarvam_docai"] = {"ok": result["ok"], "detail": result["detail"]}
            if result["ok"]:
                extract_fields(checklist, result["text"], "sarvam-docai", "")
            else:
                checklist.warnings.append("Document AI degraded - " + result["detail"])
        except Exception as error:
            checklist.stages["sarvam_docai"] = {"ok": False, "detail": "Document AI crashed: " + type(error).__name__}
            checklist.warnings.append("Document AI stage crashed; continuing.")

        # Fallback: a digital PDF carries its own text layer, so the checklist
        # still fills in when Document AI is unavailable. Scans yield nothing
        # here and genuinely need Sarvam.
        if not any(f.found for f in checklist.fields.values()):
            try:
                import attachments

                text = attachments.extract_text(attachment_token)
                if text.strip():
                    extract_fields(checklist, text, "pdf-text-layer", "")
                    checklist.stages["pdf_text"] = {"ok": True, "detail": "read the PDF's own text layer"}
                else:
                    checklist.stages["pdf_text"] = {
                        "ok": False,
                        "detail": "no text layer - this looks scanned, so Document AI is required",
                    }
            except Exception as error:
                checklist.stages["pdf_text"] = {"ok": False, "detail": "text-layer read failed: " + type(error).__name__}

        # Last resort so the document is at least identifiable.
        checklist.set("tender_title", uploaded.filename.rsplit(".", 1)[0], "uploaded filename")

    # Stage 3 - Anakin Search contact enrichment, only if contact is still missing.
    if not checklist.fields["contact"].found:
        try:
            authority = checklist.fields["issuing_authority"].value or ""
            contact, meta = anakin.search_contact(str(authority))
            checklist.stages["anakin_search"] = {"ok": meta["ok"], "detail": meta["detail"]}
            if meta["ok"]:
                checklist.set("contact", contact, "anakin-search")
        except Exception as error:
            checklist.stages["anakin_search"] = {"ok": False, "detail": "search crashed: " + type(error).__name__}

    checklist.finalise()
    checklist.summary = build_summary(checklist)
    payload = checklist.to_dict()
    payload["source_url"] = input_ref if input_type == "url" else ""
    return payload
