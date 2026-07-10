const SIDE_PANEL_URL_KEY = "oeSidePanelUrl";
const THEME_STORAGE_KEY = "oeTheme";
const DEFAULT_THEME = "system";

const frame = document.querySelector("#oe-frame");
const empty = document.querySelector("#panel-empty");
const openTabButton = document.querySelector("#open-tab");
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

// The iframe is cross-origin, so we can't read where the user has navigated to
// inside it. The oe-sidepane.js content script answers a postMessage request
// with the frame's live URL; if no answer arrives (frame not loaded, script not
// injected), fall back to the URL the panel was opened with.
const URL_REQUEST_TYPE = "oe-sidepanel-url-request";
const URL_RESPONSE_TYPE = "oe-sidepanel-url-response";
const URL_RESPONSE_TIMEOUT_MS = 300;

function openInTab(url) {
  chrome.tabs.create({ url, active: true });
}

openTabButton.addEventListener("click", () => {
  if (!currentUrl) {
    return;
  }

  const contentWindow = frame.hidden ? null : frame.contentWindow;
  if (!contentWindow) {
    openInTab(currentUrl);
    return;
  }

  let settled = false;
  const settle = (url) => {
    if (settled) {
      return;
    }
    settled = true;
    window.clearTimeout(timer);
    window.removeEventListener("message", onMessage);
    openInTab(url);
  };

  const timer = window.setTimeout(() => settle(currentUrl), URL_RESPONSE_TIMEOUT_MS);
  const onMessage = (event) => {
    if (event.source !== contentWindow || event.data?.type !== URL_RESPONSE_TYPE) {
      return;
    }
    settle(typeof event.data.url === "string" && event.data.url ? event.data.url : currentUrl);
  };

  window.addEventListener("message", onMessage);
  contentWindow.postMessage({ type: URL_REQUEST_TYPE }, new URL(currentUrl).origin);
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
