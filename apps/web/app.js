let tenders = [];
let checklist = null;
let workspace = null;
let activeLanguage = "en-IN";

const byId = (id) => document.getElementById(id);

function unwrapTrpc(body) {
  if (body.error) {
    throw new Error(body.error.message || body.error.data?.message || "Request failed");
  }
  return body.result?.data?.json ?? body.result?.data;
}

async function trpcQuery(path, input) {
  const url = new URL(`/trpc/${path}`, window.location.origin);
  if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));
  const response = await fetch(url);
  return unwrapTrpc(await response.json());
}

async function trpcMutate(path, input) {
  const response = await fetch(`/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  return unwrapTrpc(await response.json());
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.detail || body.message || "Request failed");
  return body;
}

function tenderUrl(tender) {
  return tender.url || tender.source_url || "";
}

async function loadCatalog() {
  byId("resultCount").textContent = "Loading active tenders...";
  try {
    let data;
    try {
      data = await requestJson("/api/tenders");
    } catch {
      data = await trpcQuery("tenders.list");
    }
    tenders = data.tenders || [];
    byId("lastUpdated").textContent = `Catalog checked ${new Date(data.updated_at).toLocaleString("en-IN")}`;
    byId("watchSummary").textContent = "Catalog + Anakin pipeline ready";
    renderCatalog();
  } catch (error) {
    byId("resultCount").textContent = `Catalog could not load: ${error.message}`;
  }
}

function renderCatalog() {
  const query = byId("searchInput").value.trim().toLowerCase();
  const sort = byId("sortSelect").value;
  const visible = tenders.filter((tender) =>
    `${tender.title} ${tender.id} ${tender.authority}`.toLowerCase().includes(query)
  );
  if (sort === "title") visible.sort((left, right) => left.title.localeCompare(right.title));

  const grid = byId("tenderGrid");
  const template = byId("cardTemplate");
  grid.innerHTML = "";
  visible.forEach((tender) => {
    const card = template.content.cloneNode(true);
    const url = tenderUrl(tender);
    card.querySelector(".card-source").textContent = "CPPP · Central Government";
    card.querySelector("h3").textContent = tender.title;
    card.querySelector(".card-id").textContent = `Tender ID: ${tender.id}`;
    card.querySelector(".card-open").addEventListener("click", () => openTender(tender));
    card.querySelector(".card-link").href = url;
    grid.appendChild(card);
  });
  byId("resultCount").textContent = `${visible.length} active tender${visible.length === 1 ? "" : "s"}`;
  if (!visible.length) grid.innerHTML = `<p class="empty-watch">No active tenders match this search.</p>`;
}

function setBusy(message) {
  stopVoice();
  byId("workspace").hidden = false;
  byId("detailTitle").textContent = message;
  byId("detailMeta").textContent = "";
  byId("checklist").innerHTML = "";
  byId("plainBrief").textContent = "";
  byId("changeStatus").textContent = "Running";
  byId("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openTender(tender) {
  const url = tenderUrl(tender);
  if (url) byId("urlInput").value = url;
  await checkUrl(url, tender);
}

async function checkUrl(url, tender) {
  if (url) byId("urlInput").value = url;
  setBusy("Reading the tender notice...");
  try {
    const result = await requestJson("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    renderChecklist(result);
    await loadAnakinIngest({ tenderId: tender?.id, url, title: tender?.title, authority: tender?.authority });
  } catch {
    if (tender?.id) {
      await openWorkspaceTrpc(tender.id);
      return;
    }
    byId("detailTitle").textContent = "Could not check that tender. Confirm the URL on the official page.";
  }
}

async function openWorkspaceTrpc(tenderId) {
  workspace = await trpcQuery("tenders.getById", { id: tenderId });
  byId("workspace").hidden = false;
  byId("detailTitle").textContent = workspace.title;
  byId("detailMeta").textContent = workspace.authority;
  byId("detailId").textContent = workspace.id;
  byId("officialLink").href = workspace.source_url;
  byId("proposalOutline").value = (workspace.response_outline || []).join("\n");
  byId("checklist").innerHTML = (workspace.requirements || [])
    .map((item) => `<label><input type="checkbox" /><span>${item.label}<small>${item.source}</small></span></label>`)
    .join("");
  byId("documentList").innerHTML = (workspace.documents || [])
    .map((document) => `<a href="${document.url}" target="_blank" rel="noreferrer">${document.name}<span>${document.state} ↗</span></a>`)
    .join("");
  document.querySelectorAll("#checklist input").forEach((input) => input.addEventListener("change", updateProgress));
  updateProgress();
  await translateBrief();
  await loadAnakinIngest({ tenderId });
}

async function checkDocument(file) {
  setBusy("Extracting the uploaded notice with Sarvam Document AI...");
  const data = new FormData();
  data.append("document", file);
  try {
    renderChecklist(await requestJson("/api/check/document", { method: "POST", body: data }));
  } catch (error) {
    byId("detailTitle").textContent = `Could not read that document: ${error.message}`;
  }
}

function renderChecklist(result) {
  checklist = result;
  workspace = { summary: result.summary, source_url: result.source_url };
  const fields = result.fields;

  byId("workspace").hidden = false;
  byId("detailTitle").textContent = fields.tender_title.found ? fields.tender_title.value : "Tender notice";
  byId("detailMeta").textContent = fields.issuing_authority.found ? fields.issuing_authority.value : "Issuing department not published";
  byId("detailId").textContent = fields.tender_id.found ? fields.tender_id.value : "Not found";
  byId("officialLink").href = result.source_url || "#";
  byId("progressText").textContent = `${result.found_count}/${result.total_count}`;

  byId("checklist").innerHTML = Object.entries(fields)
    .map(([key, field]) => {
      const value = Array.isArray(field.value) ? field.value.join(", ") : field.value;
      const state = field.found ? "found" : "missing";
      const detail = field.found ? escapeHtml(String(value)) : escapeHtml(field.note);
      const badge = field.found ? escapeHtml(field.source) : "confirm on official page";
      return `<label class="check-row ${state}" data-key="${key}">
        <input type="checkbox" ${field.found ? "" : "disabled"} />
        <span><strong>${escapeHtml(field.label)}</strong><em>${detail}</em><small>${badge}</small></span>
      </label>`;
    })
    .join("");

  const stageRows = Object.entries(result.stages || {})
    .map(([name, stage]) => `<li class="${stage.ok ? "stage-ok" : "stage-bad"}"><strong>${escapeHtml(name)}</strong> ${escapeHtml(stage.detail)}</li>`)
    .join("");
  const warnings = (result.warnings || []).map((w) => `<li class="stage-bad">${escapeHtml(w)}</li>`).join("");
  byId("changeStatus").textContent = result.partial ? `${result.missing.length} missing` : "Complete";
  byId("changeContent").innerHTML = `<ul class="stage-list">${stageRows}${warnings}</ul><div id="anakinPanel"></div>`;

  byId("proposalOutline").value = result.missing.length
    ? `Still to confirm on the official page:\n- ${result.missing.join("\n- ")}`
    : "All checklist fields were extracted from the notice.";

  translateBrief().catch((error) => {
    byId("translationNotice").textContent = error.message;
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}

function renderAnakin(anakin) {
  const status = byId("changeStatus");
  const host = byId("anakinPanel") || byId("changeContent");
  if (!anakin) return;
  status.textContent = anakin.scrape?.ok ? (anakin.usedFallback ? "Search fallback" : "Scraped") : status.textContent || "Fallback";
  const contacts = anakin.contacts || {};
  const emails = (contacts.emails || []).join(", ") || "Not found";
  const phones = (contacts.phones || []).join(", ") || "Not found";
  const department = contacts.department || anakin.search?.contacts?.department || "Not found";
  const excerpt = anakin.excerpt || anakin.scrape?.fallbackMessage || anakin.message;
  const block = `<div class="change-entry"><strong>${escapeHtml(anakin.message)}</strong><p>${escapeHtml(excerpt)}</p><small>Department: ${escapeHtml(department)}<br />Email: ${escapeHtml(emails)}<br />Phone: ${escapeHtml(phones)}<br />Cache: ${anakin.scrape?.cached ? "hit" : "fresh"}${anakin.usedFallback ? " · Search used" : ""}</small></div>`;
  if (byId("anakinPanel")) {
    byId("anakinPanel").innerHTML = block;
  } else {
    host.insertAdjacentHTML("beforeend", block);
  }
}

async function loadAnakinIngest(input) {
  try {
    const anakin = await trpcMutate("anakin.ingest", input);
    workspace = { ...(workspace || {}), anakin };
    if (anakin.excerpt && workspace) workspace.summary = anakin.excerpt;
    renderAnakin(anakin);
  } catch {
    const host = byId("anakinPanel") || byId("changeContent");
    const note = `<div class="change-entry"><strong>Anakin live scrape skipped on this server.</strong><p>Python pipeline still ran. Start the Node API on :4000 for the JS Anakin SDK panel.</p></div>`;
    if (byId("anakinPanel")) byId("anakinPanel").innerHTML = note;
    else host.insertAdjacentHTML("beforeend", note);
  }
}

async function translateBrief() {
  const summary = checklist?.summary || workspace?.summary;
  if (!summary) return;
  const notice = byId("translationNotice");
  document.querySelectorAll(".language-button").forEach((button) =>
    button.classList.toggle("active", button.dataset.language === activeLanguage)
  );

  if (activeLanguage === "en-IN") {
    byId("plainBrief").textContent = summary;
    notice.textContent = "Original English summary.";
    return;
  }
  notice.textContent = "Translating with Sarvam...";
  try {
    const result = await requestJson("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summary, target_language_code: activeLanguage }),
    });
    byId("plainBrief").textContent = result.translated_text;
    notice.textContent = result.notice || (result.provider === "sarvam" ? "Translated by Sarvam." : "");
  } catch {
    const result = await trpcMutate("sarvam.translate", { text: summary, target_language_code: activeLanguage });
    byId("plainBrief").textContent = result.translated_text;
    notice.textContent = result.provider === "sarvam" ? "Translated by Sarvam." : result.notice;
  }
}

const voiceCache = new Map();
const voicePlayer = new Audio();
let voiceToken = 0;
let voiceState = "idle";

function setVoiceUi(state, message) {
  voiceState = state;
  const play = byId("listenButton");
  const stop = byId("stopButton");
  const notice = byId("translationNotice");
  play.disabled = state === "loading";
  play.classList.toggle("active", state === "playing");
  play.textContent = state === "playing" ? "❚❚" : "▶";
  play.title = state === "playing" ? "Pause spoken summary" : "Play spoken summary";
  stop.disabled = state === "idle" || state === "loading";
  if (message) notice.textContent = message;
}

function stopVoice() {
  voiceToken += 1;
  voicePlayer.pause();
  voicePlayer.removeAttribute("src");
  voicePlayer.load();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  setVoiceUi("idle", "Voice stopped.");
}

voicePlayer.addEventListener("ended", () => {
  if (voiceState === "playing") setVoiceUi("idle", "Spoken by Sarvam bulbul");
});
voicePlayer.addEventListener("pause", () => {
  if (voiceState === "playing" && !voicePlayer.ended) setVoiceUi("paused", "Paused.");
});
voicePlayer.addEventListener("play", () => {
  setVoiceUi("playing", "Spoken by Sarvam bulbul");
});

async function playSarvamClip(base64) {
  voicePlayer.src = `data:audio/wav;base64,${base64}`;
  await voicePlayer.play();
}

async function speakBrief() {
  const text = byId("plainBrief").textContent.trim();
  const notice = byId("translationNotice");
  if (!text) {
    notice.textContent = "Nothing to read yet. Open a tender first.";
    return;
  }

  if (voiceState === "loading") return;
  if (voiceState === "playing") {
    voicePlayer.pause();
    if ("speechSynthesis" in window) speechSynthesis.pause();
    setVoiceUi("paused", "Paused.");
    return;
  }
  if (voiceState === "paused") {
    try {
      await voicePlayer.play();
      setVoiceUi("playing", "Spoken by Sarvam bulbul");
    } catch {
      if ("speechSynthesis" in window) speechSynthesis.resume();
      setVoiceUi("playing", "Windows voice resumed.");
    }
    return;
  }

  const cacheKey = `${activeLanguage}::${text}`;
  const token = ++voiceToken;
  setVoiceUi("loading", "Loading Sarvam voice...");

  try {
    let audio = voiceCache.get(cacheKey);
    if (!audio) {
      let result = null;
      try {
        result = await requestJson("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language: activeLanguage }),
        });
      } catch {
        result = await trpcMutate("sarvam.speak", { text, language: activeLanguage });
      }
      if (token !== voiceToken) return;
      if (result?.ok && result.audio_base64) {
        audio = result.audio_base64;
        voiceCache.set(cacheKey, audio);
      } else {
        throw new Error(result?.notice || "Sarvam TTS returned no audio");
      }
    }
    if (token !== voiceToken) return;
    await playSarvamClip(audio);
    if (token !== voiceToken) return;
    setVoiceUi("playing", "Spoken by Sarvam bulbul");
  } catch (error) {
    if (token !== voiceToken) return;
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = activeLanguage;
      utterance.onend = () => {
        if (token === voiceToken) setVoiceUi("idle", "Windows voice finished.");
      };
      speechSynthesis.speak(utterance);
      setVoiceUi("playing", `Sarvam unavailable. Windows voice: ${error.message}`);
      return;
    }
    setVoiceUi("idle", `Sarvam voice unavailable: ${error.message}`);
  }
}

function updateProgress() {
  const checks = [...document.querySelectorAll("#checklist input")];
  byId("progressText").textContent = `${checks.filter((check) => check.checked).length}/${checks.length}`;
}

async function refreshCatalog() {
  const button = byId("refreshButton");
  button.disabled = true;
  try {
    try {
      const result = await trpcMutate("tenders.refresh");
      byId("watchSummary").textContent = result.snapshot?.changed
        ? `${result.snapshot.new_tenders} listing changes found`
        : "No catalog changes found";
    } catch {
      byId("watchSummary").textContent = "Catalog refreshed";
    }
    await loadCatalog();
  } catch (error) {
    byId("watchSummary").textContent = `Refresh unavailable: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

byId("searchInput").addEventListener("input", renderCatalog);
byId("sortSelect").addEventListener("change", renderCatalog);
byId("refreshButton").addEventListener("click", refreshCatalog);
byId("checkForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const url = byId("urlInput").value.trim();
  if (url) checkUrl(url);
});
byId("exportButton").addEventListener("click", async () => {
  if (!checklist) return;
  const button = byId("exportButton");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Building document...";
  try {
    const languageButton = document.querySelector(".language-button.active");
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checklist,
        attachment_token: checklist.attachment_token || "",
        summary: byId("plainBrief").textContent,
        language_label: languageButton ? languageButton.textContent : "English",
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Export failed");
    }
    const blob = await response.blob();
    const name = (response.headers.get("Content-Disposition") || "").match(/filename="?([^";]+)"?/);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name ? name[1] : "tender-readiness-summary.docx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    byId("translationNotice").textContent = `Export failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});

byId("sampleButton").addEventListener("click", async () => {
  setBusy("Running the bundled sample notice through the extractor...");
  try {
    renderChecklist(await requestJson("/api/check/sample", { method: "POST" }));
  } catch (error) {
    byId("detailTitle").textContent = `Sample failed: ${error.message}`;
  }
});
byId("digitiseForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const file = byId("documentInput").files[0];
  if (!file) {
    byId("digitiseStatus").textContent = "Choose an official PDF or image first.";
    return;
  }
  checkDocument(file);
});
document.querySelectorAll(".language-button").forEach((button) =>
  button.addEventListener("click", () => {
    stopVoice();
    activeLanguage = button.dataset.language;
    translateBrief().catch((error) => {
      byId("translationNotice").textContent = error.message;
    });
  })
);
byId("listenButton").addEventListener("click", () => {
  speakBrief().catch((error) => {
    byId("translationNotice").textContent = error.message;
  });
});
byId("stopButton").addEventListener("click", stopVoice);
setVoiceUi("idle");

loadCatalog();
