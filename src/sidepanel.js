const SIDE_PANEL_URL_KEY = "oeSidePanelUrl";
const THEME_STORAGE_KEY = "oeTheme";
const DEFAULT_THEME = "system";

const frame = document.querySelector("#oe-frame");
const empty = document.querySelector("#panel-empty");
const openTabButton = document.querySelector("#open-tab");
const newQueryButton = document.querySelector("#new-query");
const closeButton = document.querySelector("#close-panel");
const settingsButton = document.querySelector("#open-settings");
const titleEl = document.querySelector("#panel-title");
const colorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

let currentUrl = "";
let currentTheme = DEFAULT_THEME;

function normalizeTheme(value) {
  return ["system", "light", "dark"].includes(value) ? value : DEFAULT_THEME;
}

function applyTheme(value) {
  currentTheme = normalizeTheme(value);
  const resolved = currentTheme === "system" ? (colorSchemeQuery?.matches ? "dark" : "light") : currentTheme;
  document.documentElement.dataset.theme = resolved;
}

function setSource(url, label) {
  if (typeof url !== "string" || !url || url === currentUrl) {
    return;
  }

  currentUrl = url;
  if (label) {
    titleEl.textContent = label;
    frame.title = label;
  }
  frame.src = url;
  frame.hidden = false;
  empty.hidden = true;
  openTabButton.hidden = false;
}

openTabButton.addEventListener("click", () => {
  if (currentUrl) {
    chrome.tabs.create({ url: currentUrl, active: true });
  }
});

newQueryButton.addEventListener("click", () => {
  currentUrl = "";
  frame.src = "";
  frame.hidden = true;
  empty.hidden = false;
  openTabButton.hidden = true;
  titleEl.textContent = "OpenEvidence";
});

settingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// window.close() dismisses the side panel from within its own page.
closeButton.addEventListener("click", () => {
  window.close();
});

chrome.storage.session.get({ [SIDE_PANEL_URL_KEY]: null }, (items) => {
  const value = items[SIDE_PANEL_URL_KEY];
  if (value?.url) {
    setSource(value.url, value.label);
  }
});

chrome.storage.sync.get({ [THEME_STORAGE_KEY]: DEFAULT_THEME }, (items) => {
  applyTheme(items[THEME_STORAGE_KEY]);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes[SIDE_PANEL_URL_KEY]) {
    const value = changes[SIDE_PANEL_URL_KEY].newValue;
    if (value?.url) {
      setSource(value.url, value.label);
    }
    return;
  }

  if (areaName === "sync" && changes[THEME_STORAGE_KEY]) {
    applyTheme(changes[THEME_STORAGE_KEY].newValue);
  }
});

colorSchemeQuery?.addEventListener("change", () => {
  if (currentTheme === "system") {
    applyTheme("system");
  }
});

// --- Dotflow picker ---

const DOTFLOW_MODE_KEY = "oeDotflowMode";
const DEFAULT_DOTFLOW_MODE = "inline";
const DOTFLOW_NOTES_KEY = "oeDotflowNotes";

let dotflowNotes = {};

function formatDotflowLabel(df, note) {
  const base = df.is_default ? `${df.name} ✓` : df.name;
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (!trimmed) {
    return base;
  }
  const short = trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
  return `${base} — ${short}`;
}

const dotflowForm = document.querySelector("#dotflow-form");
const dotflowSelect = document.querySelector("#dotflow-select");
const dotflowQuery = document.querySelector("#dotflow-query");
const dotflowMode = document.querySelector("#dotflow-mode");
const dotflowError = document.querySelector("#dotflow-error");

// Keep the full catalog so we can read explanation_prompt for inline mode.
let dotflowsById = new Map();

function showDotflowError(msg) {
  dotflowError.textContent = msg;
  dotflowError.hidden = false;
}

function clearDotflowError() {
  dotflowError.hidden = true;
  dotflowError.textContent = "";
}

function populateDotflowSelect(dotflows) {
  dotflowSelect.length = 1;
  dotflowsById = new Map();
  for (const df of dotflows) {
    dotflowsById.set(df.id, df);
    const opt = document.createElement("option");
    opt.value = df.id;
    opt.dataset.name = df.name;
    opt.textContent = formatDotflowLabel(df, dotflowNotes[df.id]);
    if (dotflowNotes[df.id]) {
      opt.title = dotflowNotes[df.id];
    }
    dotflowSelect.appendChild(opt);
  }
}

// Load notes first so the picker labels include them on the first render.
chrome.storage.sync.get({ [DOTFLOW_NOTES_KEY]: {}, [DOTFLOW_MODE_KEY]: DEFAULT_DOTFLOW_MODE }, (items) => {
  dotflowNotes = items[DOTFLOW_NOTES_KEY] && typeof items[DOTFLOW_NOTES_KEY] === "object" ? items[DOTFLOW_NOTES_KEY] : {};
  dotflowMode.value = items[DOTFLOW_MODE_KEY] === "official" ? "official" : "inline";

  chrome.runtime.sendMessage({ type: "OE_FETCH_DOTFLOWS" }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.ok && Array.isArray(response.dotflows)) {
      populateDotflowSelect(response.dotflows);
    } else if (response && response.ok === false) {
      showDotflowError(`Couldn't load dotflows: ${response.error || "unknown error"}`);
    }
  });
});

// Live-refresh labels when notes are edited in Options while the panel is open.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[DOTFLOW_NOTES_KEY]) {
    const next = changes[DOTFLOW_NOTES_KEY].newValue;
    dotflowNotes = next && typeof next === "object" ? next : {};
    if (dotflowsById.size > 0) {
      populateDotflowSelect(Array.from(dotflowsById.values()));
    }
  }
});
dotflowMode.addEventListener("change", () => {
  chrome.storage.sync.set({ [DOTFLOW_MODE_KEY]: dotflowMode.value });
});

dotflowForm.addEventListener("submit", (e) => {
  e.preventDefault();
  clearDotflowError();

  const question = dotflowQuery.value.trim();
  if (!question) {
    showDotflowError("Please enter a question.");
    return;
  }

  const dotflowId = dotflowSelect.value || "";
  const selectedOpt = dotflowSelect.options[dotflowSelect.selectedIndex];
  const dotflowName = selectedOpt?.dataset.name || "";
  const mode = dotflowMode.value === "official" ? "official" : "inline";
  const selectedFlow = dotflowId ? dotflowsById.get(dotflowId) : null;

  // Inline (default, stable): prepend the dotflow's own prompt text so OE follows
  // it as plain instructions — no private API, nothing to break on OE redeploys.
  // Official (experimental): send the bare question + a custom URL param that the
  // MAIN-world interceptor uses to attach dotflow.id to POST /api/article.
  let query = question;
  let urlDotflowId = "";
  if (selectedFlow) {
    if (mode === "official") {
      urlDotflowId = dotflowId;
    } else if (selectedFlow.explanation_prompt) {
      query = `${selectedFlow.explanation_prompt}\n\n---\n\n${question}`;
    }
  }

  const params = new URLSearchParams({
    query,
    configName: "prod",
    attachments: "[]",
    _rsc: "1pln2"
  });
  if (urlDotflowId) params.set("oe_ext_dotflow_id", urlDotflowId);
  const url = `https://www.openevidence.com/ask?${params.toString()}`;

  setSource(url, dotflowName ? `OE · ${dotflowName}` : "OpenEvidence");

  chrome.runtime.sendMessage({
    type: "OE_OPEN_QUERY",
    query,
    dotflowName,
    dotflowId: urlDotflowId,
    meta: { source: "sidepanel" }
  });
});
