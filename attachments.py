"""Keep uploaded tender documents so their pages can be embedded in the export.

A PDF is rendered to one PNG per page; an uploaded image is kept as-is. Files
live under data/uploads/<token>/ and are addressed by that token, so nothing in
the request path has to carry raw bytes around.
"""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

UPLOAD_ROOT = Path(__file__).parent / "data" / "uploads"
MAX_PAGES = 12          # a full tender PDF can run to hundreds; cap the export
RENDER_DPI = 110
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}


def _token_dir(token: str) -> Path:
    """Resolve a token to its directory, refusing anything that escapes the root."""
    candidate = (UPLOAD_ROOT / token).resolve()
    if candidate.parent != UPLOAD_ROOT.resolve():
        raise ValueError("invalid attachment token")
    return candidate


def store(uploaded) -> dict:
    """Save an upload and render its pages. Never raises; reports via `ok`."""
    result = {"ok": False, "token": "", "page_count": 0, "detail": ""}
    try:
        token = uuid.uuid4().hex
        directory = UPLOAD_ROOT / token
        directory.mkdir(parents=True, exist_ok=True)

        suffix = Path(uploaded.filename or "").suffix.lower()
        original = directory / ("original" + (suffix or ".bin"))
        uploaded.stream.seek(0)
        original.write_bytes(uploaded.stream.read())
        uploaded.stream.seek(0)

        if suffix in IMAGE_SUFFIXES:
            shutil.copyfile(original, directory / "page-001.png")
            result.update(ok=True, token=token, page_count=1, detail="image stored")
            return result

        if suffix == ".pdf":
            import pymupdf

            with pymupdf.open(original) as pdf:
                page_count = len(pdf)          # read before the document closes
                total = min(page_count, MAX_PAGES)
                for index in range(total):
                    pixmap = pdf[index].get_pixmap(dpi=RENDER_DPI)
                    pixmap.save(directory / f"page-{index + 1:03d}.png")
            detail = f"{total} page(s) rendered"
            if page_count > MAX_PAGES:
                detail += f" (first {MAX_PAGES} of {page_count})"
            result.update(ok=True, token=token, page_count=total, detail=detail)
            return result

        result["detail"] = f"Unsupported file type: {suffix or 'unknown'}"
    except Exception as error:
        result["detail"] = f"Could not store the upload: {type(error).__name__}"
    return result


def extract_text(token: str) -> str:
    """Read a stored PDF's own text layer. The offline fallback for Document AI:
    a digital (non-scanned) notice yields its fields without any API key."""
    if not token:
        return ""
    try:
        directory = _token_dir(token)
    except ValueError:
        return ""
    original = next(directory.glob("original.pdf"), None) if directory.is_dir() else None
    if original is None:
        return ""
    try:
        import pymupdf

        with pymupdf.open(original) as pdf:
            return "\n".join(page.get_text() for page in pdf)
    except Exception:
        return ""


def pages(token: str) -> list:
    """Page images for a token, ready to hand to the exporter."""
    if not token:
        return []
    try:
        directory = _token_dir(token)
    except ValueError:
        return []
    if not directory.is_dir():
        return []
    images = sorted(directory.glob("page-*.png"))
    return [
        {"path": str(path), "caption": f"Uploaded document - page {index}"}
        for index, path in enumerate(images, start=1)
    ]
