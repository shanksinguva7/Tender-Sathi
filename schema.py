"""Fixed extraction contract for Tender Readiness Checker.

This is the one shared schema every service writes into and the frontend reads.
Task 1 (Shashank): eligibility, EMD, documents, deadline, contact.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

SCHEMA_VERSION = "1.0"

# Every field the pipeline promises the frontend. Order drives checklist order.
FIELDS = [
    ("tender_title", "Tender title"),
    ("tender_id", "Tender / reference number"),
    ("issuing_authority", "Issuing department"),
    ("eligibility", "Eligibility criteria"),
    ("emd_amount", "EMD / bid security"),
    ("tender_fee", "Tender document fee"),
    ("required_documents", "Required documents"),
    ("submission_deadline", "Bid submission deadline"),
    ("opening_date", "Bid opening date"),
    ("contact", "Nodal officer / contact"),
]

LIST_FIELDS = {"eligibility", "required_documents"}


@dataclass
class Field:
    """One extracted value plus where it came from and whether we trust it."""

    label: str
    value: object = None          # str, or list[str] for LIST_FIELDS
    found: bool = False
    source: str = "not found"     # anakin | sarvam-docai | listing | not found
    source_url: str = ""
    note: str = ""                # shown to the user when found is False


@dataclass
class TenderChecklist:
    schema_version: str = SCHEMA_VERSION
    input_type: str = ""          # url | pdf
    input_ref: str = ""
    fields: dict = field(default_factory=dict)
    summary: str = ""             # plain-language text -> translate + TTS
    missing: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    stages: dict = field(default_factory=dict)   # per-stage ok/failed, for error surfacing
    partial: bool = False

    @classmethod
    def blank(cls, input_type: str, input_ref: str) -> "TenderChecklist":
        return cls(
            input_type=input_type,
            input_ref=input_ref,
            fields={key: Field(label=label) for key, label in FIELDS},
        )

    def set(self, key: str, value, source: str, source_url: str = "") -> None:
        empty = value is None or value == "" or value == []
        target = self.fields[key]
        if empty or target.found:
            return
        target.value, target.found, target.source, target.source_url = value, True, source, source_url

    def finalise(self) -> "TenderChecklist":
        self.missing = [f.label for f in self.fields.values() if not f.found]
        for f in self.fields.values():
            if not f.found:
                f.note = "Not published in the scraped notice - confirm on the official tender page."
        self.partial = bool(self.missing)
        return self

    def to_dict(self) -> dict:
        out = asdict(self)
        out["fields"] = {k: asdict(v) for k, v in self.fields.items()}
        out["found_count"] = sum(1 for f in self.fields.values() if f.found)
        out["total_count"] = len(self.fields)
        return out
