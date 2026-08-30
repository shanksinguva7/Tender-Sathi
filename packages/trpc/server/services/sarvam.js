// @ts-nocheck

async function sarvamTranslate(text, targetLanguageCode) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return {
      translated_text: text,
      provider: "offline",
      notice: "Set SARVAM_API_KEY to enable live translation.",
    };
  }
  if (targetLanguageCode === "en-IN") {
    return { translated_text: text, provider: "offline", notice: "Original English text." };
  }

  const response = await fetch("https://api.sarvam.ai/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify({
      input: text,
      source_language_code: "en-IN",
      target_language_code: targetLanguageCode,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Sarvam translate HTTP ${response.status}: ${detail.slice(0, 180)}`);
  }
  const body = await response.json();
  return {
    translated_text: body.translated_text ?? text,
    provider: "sarvam",
    notice: "Translated by Sarvam",
  };
}

async function sarvamSpeak(text, languageCode) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      audio_base64: "",
      notice: "Set SARVAM_API_KEY to use Sarvam bulbul instead of the Windows voice.",
    };
  }

  const payload = {
    text: String(text).slice(0, 1500),
    language_code: languageCode || "en-IN",
    model: "bulbul:v3",
    speaker: "shubh",
  };

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Sarvam TTS HTTP ${response.status}: ${detail.slice(0, 180)}`);
  }
  const body = await response.json();
  const audio = Array.isArray(body.audios) ? body.audios[0] : "";
  if (!audio) {
    return { ok: false, audio_base64: "", notice: "Sarvam TTS returned no audio." };
  }
  return {
    ok: true,
    audio_base64: audio,
    notice: "Spoken by Sarvam bulbul",
  };
}

module.exports = { sarvamTranslate, sarvamSpeak };
