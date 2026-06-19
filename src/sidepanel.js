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

const dotflowForm = document.querySelector("#dotflow-form");
const dotflowSelect = document.querySelector("#dotflow-select");
const dotflowQuery = document.querySelector("#dotflow-query");
const dotflowError = document.querySelector("#dotflow-error");

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
  for (const df of dotflows) {
    const opt = document.createElement("option");
    opt.value = df.id;
    opt.dataset.name = df.name;
    opt.textContent = df.is_default ? `${df.name} ✓` : df.name;
    dotflowSelect.appendChild(opt);
  }
}

chrome.runtime.sendMessage({ type: "OE_FETCH_DOTFLOWS" }, (response) => {
  if (chrome.runtime.lastError) return;
  if (response?.ok && Array.isArray(response.dotflows)) {
    populateDotflowSelect(response.dotflows);
  }
});

dotflowForm.addEventListener("submit", (e) => {
  e.preventDefault();
  clearDotflowError();

  const query = dotflowQuery.value.trim();
  if (!query) {
    showDotflowError("Please enter a question.");
    return;
  }

  const dotflowId = dotflowSelect.value || "";
  const selectedOpt = dotflowSelect.options[dotflowSelect.selectedIndex];
  const dotflowName = selectedOpt?.dataset.name || "";

  const params = new URLSearchParams({
    query,
    configName: "prod",
    attachments: "[]",
    _rsc: "1pln2"
  });
  if (dotflowId) params.set("oe_ext_dotflow_id", dotflowId);
  const url = `https://www.openevidence.com/ask?${params.toString()}`;

  setSource(url, dotflowName ? `OE · ${dotflowName}` : "OpenEvidence");

  chrome.runtime.sendMessage({
    type: "OE_OPEN_QUERY",
    query,
    dotflowName,
    dotflowId,
    meta: { source: "sidepanel" }
  });
});
