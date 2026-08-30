"""Anakin.io adapter - URL scrape + search fallback, with cache.

Ishaan owns the live Anakin calls; this adapter is the seam the orchestrator
codes against. Never raises: returns (text, meta) and reports failure in meta.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"
API_BASE = "https://api.anakin.io/v1"
TIMEOUT = 25


def _cache_path(url: str) -> Path:
    return CACHE_DIR / f"{hashlib.sha256(url.encode()).hexdigest()[:20]}.json"


def _read_cache(url: str):
    path = _cache_path(url)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_cache(url: str, payload: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(url).write_text(json.dumps(payload), encoding="utf-8")
    except Exception:
        pass


def _local_batches(url: str):
    """Pre-scraped Anakin batch jobs committed in the repo (demo fallback)."""
    root = Path(__file__).parent.parent
    for name in ("tender-details-batch-1.md", "tender-details-batch-2.md"):
        path = root / name
        if not path.exists():
            continue
        try:
            job = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for result in job.get("results", []):
            if result.get("url") == url:
                text = result.get("markdown") or ""
                html = result.get("cleanedHtml") or result.get("html") or ""
                return f"{text}\n{html}"
    return None


def scrape(url: str) -> tuple[str, dict]:
    """Return (text, meta). meta.ok is False when nothing usable came back."""
    meta = {"stage": "anakin.scrape", "url": url, "ok": False, "provider": None, "detail": ""}

    cached = _read_cache(url)
    if cached:
        meta.update(ok=True, provider="cache", detail="served from local cache")
        return cached.get("text", ""), meta

    api_key = os.environ.get("ANAKIN_API_KEY") or os.environ.get("ANAKIN_API_TOKEN")
    if api_key:
        try:
            import requests

            response = requests.post(
                f"{API_BASE}/scrape",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"url": url, "format": "markdown"},
                timeout=TIMEOUT,
            )
            response.raise_for_status()
            body = response.json()
            text = body.get("markdown") or body.get("cleanedHtml") or body.get("html") or ""
            if text.strip():
                _write_cache(url, {"text": text})
                meta.update(ok=True, provider="anakin", detail="live scrape")
                return text, meta
            meta["detail"] = "Anakin returned an empty document"
        except Exception as error:
            meta["detail"] = f"Anakin scrape failed: {type(error).__name__}"

    local = _local_batches(url)
    if local and local.strip():
        meta.update(ok=True, provider="repo-batch", detail="pre-scraped Anakin batch job")
        return local, meta

    try:
        import requests

        response = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0 TenderSathi"})
        response.raise_for_status()
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", response.text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        if text.strip():
            _write_cache(url, {"text": text})
            meta.update(ok=True, provider="direct-fetch", detail="Anakin unavailable, fetched page directly")
            return text, meta
    except Exception as error:
        meta["detail"] = meta["detail"] or f"Direct fetch failed: {type(error).__name__}"

    meta["detail"] = meta["detail"] or "No scraper available and page is not cached"
    return "", meta


def search_contact(authority: str) -> tuple[str, dict]:
    """Search API fallback for a department contact page."""
    meta = {"stage": "anakin.search", "ok": False, "provider": None, "detail": "search fallback not run"}
    api_key = os.environ.get("ANAKIN_API_KEY") or os.environ.get("ANAKIN_API_TOKEN")
    if not api_key or not authority.strip():
        meta["detail"] = "No Anakin key set - contact enrichment skipped"
        return "", meta
    try:
        import requests

        response = requests.post(
            f"{API_BASE}/search",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"query": f"{authority} tender nodal officer contact", "limit": 3},
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        if results:
            top = results[0]
            meta.update(ok=True, provider="anakin", detail="contact enriched via Anakin Search")
            return f"{top.get('title', '')} - {top.get('url', '')}", meta
        meta["detail"] = "Anakin search returned no results"
    except Exception as error:
        meta["detail"] = f"Anakin search failed: {type(error).__name__}"
    return "", meta
