"""Sarvam.ai adapter - Document AI (with polling), Translate, TTS.

Bhargava owns the live Sarvam calls; this adapter is the seam the orchestrator
codes against. Never raises: every function returns a payload with `ok`.
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request

POLL_ATTEMPTS = 10
POLL_SLEEP = 2


def client():
    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        return None
    try:
        from sarvamai import SarvamAI

        return SarvamAI(api_subscription_key=api_key)
    except Exception:
        return None


def digitise(filename: str, stream, mimetype: str) -> dict:
    """Submit a PDF/image to Document AI and POLL until the text is ready."""
    out = {"stage": "sarvam.docai", "ok": False, "text": "", "detail": ""}
    sarvam = client()
    if sarvam is None:
        out["detail"] = "SARVAM_API_KEY not set - Document AI skipped"
        return out
    try:
        job = sarvam.doc_ai.digitise(
            file=[(filename, stream, mimetype)],
            language="en-IN",
            output_format="md",
            content_type="printed",
        )
        job_id = getattr(job, "job_id", None) or getattr(job, "id", None)
        out["job_id"] = job_id
        for _ in range(POLL_ATTEMPTS):
            status = sarvam.doc_ai.get_job_status(job_id=job_id)
            state = str(getattr(status, "status", "")).lower()
            if state in {"completed", "succeeded", "success"}:
                text = getattr(status, "output", None) or getattr(status, "result", "") or ""
                out.update(ok=True, text=str(text), detail="Document AI extraction complete")
                return out
            if state in {"failed", "error"}:
                out["detail"] = "Document AI job failed"
                return out
            time.sleep(POLL_SLEEP)
        out["detail"] = "Document AI still processing after polling window"
    except Exception as error:
        out["detail"] = f"Document AI unavailable: {type(error).__name__}"
    return out


def translate(text: str, target: str) -> dict:
    out = {"stage": "sarvam.translate", "ok": False, "text": text, "detail": ""}
    if target == "en-IN" or not text.strip():
        out.update(ok=True, detail="English source, no translation needed")
        return out
    sarvam = client()
    if sarvam is None:
        out["detail"] = "SARVAM_API_KEY not set - showing English text"
        return out
    try:
        # Sarvam translate caps input length; chunk on sentence boundaries.
        chunks, current = [], ""
        for sentence in text.replace("\n", " ").split(". "):
            if len(current) + len(sentence) > 900:
                chunks.append(current)
                current = ""
            current += sentence + ". "
        chunks.append(current)
        pieces = []
        for chunk in chunks:
            if not chunk.strip():
                continue
            result = sarvam.text.translate(
                input=chunk, source_language_code="en-IN", target_language_code=target
            )
            pieces.append(result.translated_text)
        out.update(ok=True, text=" ".join(pieces).strip(), detail="Translated by Sarvam")
    except Exception as error:
        out["detail"] = f"Sarvam translate unavailable: {type(error).__name__}"
    return out


def speak(text: str, language: str) -> dict:
    """Sarvam bulbul TTS -> base64 wav the browser can play directly."""
    out = {"stage": "sarvam.tts", "ok": False, "audio_base64": "", "detail": ""}
    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        out["detail"] = "SARVAM_API_KEY not set - browser voice used instead"
        return out
    try:
        payload = json.dumps({
            "text": text[:1500],
            "language_code": language or "en-IN",
            "model": "bulbul:v3",
            "speaker": "shubh",
        }).encode("utf-8")
        request = urllib.request.Request(
            "https://api.sarvam.ai/text-to-speech",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "api-subscription-key": api_key,
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
        audios = body.get("audios") or []
        if audios:
            raw = audios[0]
            out.update(
                ok=True,
                audio_base64=raw if isinstance(raw, str) else base64.b64encode(raw).decode(),
                detail="Spoken by Sarvam bulbul",
            )
            return out
        out["detail"] = "Sarvam TTS returned no audio"
    except urllib.error.HTTPError as error:
        out["detail"] = f"Sarvam TTS unavailable: HTTP {error.code}"
    except Exception as error:
        out["detail"] = f"Sarvam TTS unavailable: {type(error).__name__}"
    return out
