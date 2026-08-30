let tenders = [];
let workspace = null;
let activeLanguage = "en-IN";

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || body.message || "Request failed");
  return body;
}

async function loadCatalog() {
  document.getElementById("resultCount").textContent = "Loading active tenders...";
  const data = await requestJson("/api/tenders");
  tenders = data.tenders;
  document.getElementById("lastUpdated").textContent = `Source checked ${new Date(data.updated_at).toLocaleString("en-IN")}`;
  document.getElementById("watchSummary").textContent = "Server-side change watch ready";
  renderCatalog();
}

function renderCatalog() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const sort = document.getElementById("sortSelect").value;
  const visible = tenders.filter((tender) => `${tender.title} ${tender.id} ${tender.authority}`.toLowerCase().includes(query));
  if (sort === "title") visible.sort((left, right) => left.title.localeCompare(right.title));
  const grid = document.getElementById("tenderGrid");
  const template = document.getElementById("cardTemplate");
  grid.innerHTML = "";
  visible.forEach((tender) => {
    const card = template.content.cloneNode(true);
    card.querySelector(".card-source").textContent = "CPPP · Central Government";
    card.querySelector("h3").textContent = tender.title;
    card.querySelector(".card-id").textContent = `Tender ID: ${tender.id}`;
    card.querySelector(".card-open").addEventListener("click", () => openWorkspace(tender.id));
    const officialLink = card.querySelector(".card-link");
    officialLink.href = tender.source_url;
    grid.appendChild(card);
  });
  document.getElementById("resultCount").textContent = `${visible.length} active tender${visible.length === 1 ? "" : "s"}`;
  if (!visible.length) grid.innerHTML = `<p class="empty-watch">No active tenders match this search.</p>`;
}

async function openWorkspace(tenderId) {
  workspace = await requestJson(`/api/tenders/${encodeURIComponent(tenderId)}`);
  document.getElementById("workspace").hidden = false;
  document.getElementById("detailTitle").textContent = workspace.title;
  document.getElementById("detailMeta").textContent = workspace.authority;
  document.getElementById("detailId").textContent = workspace.id;
  document.getElementById("officialLink").href = workspace.source_url;
  document.getElementById("proposalOutline").value = workspace.response_outline.join("\n");
  document.getElementById("checklist").innerHTML = workspace.requirements.map((item) => `<label><input type="checkbox" /><span>${item.label}<small>${item.source}</small></span></label>`).join("");
  document.getElementById("documentList").innerHTML = workspace.documents.map((document) => `<a href="${document.url}" target="_blank" rel="noreferrer">${document.name}<span>${document.state} ↗</span></a>`).join("");
  document.querySelectorAll("#checklist input").forEach((input) => input.addEventListener("change", updateProgress));
  updateProgress();
  document.getElementById("changeStatus").textContent = "Watching";
  document.getElementById("changeContent").innerHTML = `<div class="empty-watch"><span>◌</span><p>${workspace.change_watch.message}</p></div>`;
  await translateWorkspace();
  document.getElementById("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function translateWorkspace() {
  if (!workspace) return;
  const notice = document.getElementById("translationNotice");
  if (activeLanguage === "en-IN") {
    document.getElementById("plainBrief").textContent = workspace.summary;
    notice.textContent = "Original English tender brief.";
    document.querySelectorAll(".language-button").forEach((button) => button.classList.toggle("active", button.dataset.language === activeLanguage));
    return;
  }
  notice.textContent = "Translating with Sarvam...";
  const result = await requestJson("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: workspace.summary, target_language_code: activeLanguage }) });
  document.getElementById("plainBrief").textContent = result.translated_text;
  notice.textContent = result.provider === "sarvam" ? "Translated by Sarvam." : result.notice;
  document.querySelectorAll(".language-button").forEach((button) => button.classList.toggle("active", button.dataset.language === activeLanguage));
}

function updateProgress() {
  const checks = [...document.querySelectorAll("#checklist input")];
  document.getElementById("progressText").textContent = `${checks.filter((check) => check.checked).length}/${checks.length}`;
}

async function refreshCatalog() {
  const button = document.getElementById("refreshButton");
  button.disabled = true;
  try {
    const result = await requestJson("/api/refresh", { method: "POST" });
    document.getElementById("watchSummary").textContent = result.snapshot.changed ? `${result.snapshot.new_tenders} listing changes found` : "No catalog changes found";
    await loadCatalog();
  } catch (error) {
    document.getElementById("watchSummary").textContent = `Refresh unavailable: ${error.message}`;
  } finally { button.disabled = false; }
}

document.getElementById("searchInput").addEventListener("input", renderCatalog);
document.getElementById("sortSelect").addEventListener("change", renderCatalog);
document.getElementById("refreshButton").addEventListener("click", refreshCatalog);
document.querySelectorAll(".language-button").forEach((button) => button.addEventListener("click", () => { activeLanguage = button.dataset.language; translateWorkspace().catch((error) => { document.getElementById("translationNotice").textContent = error.message; }); }));
document.getElementById("listenButton").addEventListener("click", () => { if (workspace && "speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(document.getElementById("plainBrief").textContent)); });
document.getElementById("digitiseForm").addEventListener("submit", async (event) => { event.preventDefault(); const file = document.getElementById("documentInput").files[0]; const status = document.getElementById("digitiseStatus"); if (!file) { status.textContent = "Choose an official PDF or image first."; return; } const data = new FormData(); data.append("document", file); status.textContent = "Submitting to Sarvam Document AI..."; try { const response = await requestJson("/api/documents/digitise", { method: "POST", body: data }); status.textContent = response.state === "submitted" ? `Sarvam job submitted: ${response.job_id}` : response.message; } catch (error) { status.textContent = error.message; } });
loadCatalog().catch((error) => { document.getElementById("resultCount").textContent = `Catalog could not load: ${error.message}`; });
