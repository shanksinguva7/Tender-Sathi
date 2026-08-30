let tenders = [];
let checklist = null;
let activeLanguage = "en-IN";

const byId = (id) => document.getElementById(id);

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.detail || "Request failed");
  return body;
}

/* ---------- demo catalog: real CPPP tenders a judge can click ---------- */

async function loadCatalog() {
  byId("resultCount").textContent = "Loading active tenders...";
  try {
    const data = await requestJson("/api/tenders");
    tenders = data.tenders;
    byId("lastUpdated").textContent = `Catalog checked ${new Date(data.updated_at).toLocaleString("en-IN")}`;
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
    card.querySelector(".card-source").textContent = "CPPP · Central Government";
    card.querySelector("h3").textContent = tender.title;
    card.querySelector(".card-id").textContent = `Tender ID: ${tender.id}`;
    card.querySelector(".card-open").addEventListener("click", () => checkUrl(tender.url));
    card.querySelector(".card-link").href = tender.url;
    grid.appendChild(card);
  });
  byId("resultCount").textContent = `${visible.length} active tender${visible.length === 1 ? "" : "s"}`;
  if (!visible.length) grid.innerHTML = `<p class="empty-watch">No active tenders match this search.</p>`;
}

/* ---------- the actual readiness check ---------- */

function setBusy(message) {
  byId("workspace").hidden = false;
  byId("detailTitle").textContent = message;
  byId("detailMeta").textContent = "";
  byId("checklist").innerHTML = "";
  byId("plainBrief").textContent = "";
  byId("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function checkUrl(url) {
  byId("urlInput").value = url;
  setBusy("Reading the tender notice...");
  try {
    renderChecklist(await requestJson("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }));
  } catch (error) {
    byId("detailTitle").textContent = `Could not check that tender: ${error.message}`;
  }
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
  const fields = result.fields;

  byId("workspace").hidden = false;
  byId("detailTitle").textContent = fields.tender_title.found ? fields.tender_title.value : "Tender notice";
  byId("detailMeta").textContent = fields.issuing_authority.found ? fields.issuing_authority.value : "Issuing department not published";
  byId("detailId").textContent = fields.tender_id.found ? fields.tender_id.value : "Not found";
  byId("officialLink").href = result.source_url || "#";
  byId("progressText").textContent = `${result.found_count}/${result.total_count}`;

  // Every field renders, found or not. Missing ones are flagged, never hidden.
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

  const changeContent = byId("changeContent");
  byId("changeStatus").textContent = result.partial ? `${result.missing.length} missing` : "Complete";
  const stageRows = Object.entries(result.stages)
    .map(([name, stage]) => `<li class="${stage.ok ? "stage-ok" : "stage-bad"}"><strong>${escapeHtml(name)}</strong> ${escapeHtml(stage.detail)}</li>`)
    .join("");
  const warnings = result.warnings.map((w) => `<li class="stage-bad">${escapeHtml(w)}</li>`).join("");
  changeContent.innerHTML = `<ul class="stage-list">${stageRows}${warnings}</ul>`;

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

/* ---------- Sarvam translate + TTS ---------- */

async function translateBrief() {
  if (!checklist) return;
  const notice = byId("translationNotice");
  document.querySelectorAll(".language-button").forEach((button) =>
    button.classList.toggle("active", button.dataset.language === activeLanguage)
  );

  if (activeLanguage === "en-IN") {
    byId("plainBrief").textContent = checklist.summary;
    notice.textContent = "Original English summary.";
    return;
  }
  notice.textContent = "Translating with Sarvam...";
  const result = await requestJson("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: checklist.summary, target_language_code: activeLanguage }),
  });
  byId("plainBrief").textContent = result.translated_text;
  notice.textContent = result.notice;
}

async function speakBrief() {
  const text = byId("plainBrief").textContent.trim();
  if (!text) return;
  const notice = byId("translationNotice");
  try {
    const result = await requestJson("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: activeLanguage }),
    });
    if (result.ok && result.audio_base64) {
      new Audio(`data:audio/wav;base64,${result.audio_base64}`).play();
      notice.textContent = result.notice;
      return;
    }
    notice.textContent = result.notice;
  } catch (error) {
    notice.textContent = `Sarvam voice unavailable: ${error.message}`;
  }
  // Fallback so the demo always has audio.
  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = activeLanguage;
    speechSynthesis.speak(utterance);
  }
}

/* ---------- wiring ---------- */

byId("searchInput").addEventListener("input", renderCatalog);
byId("sortSelect").addEventListener("change", renderCatalog);
byId("refreshButton").addEventListener("click", loadCatalog);
byId("checkForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const url = byId("urlInput").value.trim();
  if (url) checkUrl(url);
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
    activeLanguage = button.dataset.language;
    translateBrief().catch((error) => {
      byId("translationNotice").textContent = error.message;
    });
  })
);
byId("listenButton").addEventListener("click", speakBrief);

loadCatalog();
