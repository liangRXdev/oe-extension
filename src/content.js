const STORAGE_KEY = "oeWhitelist";
const CUSTOM_PROMPTS_STORAGE_KEY = "oeCustomPrompts";
const THEME_STORAGE_KEY = "oeTheme";
const GROQ_VALIDATED_STORAGE_KEY = "oeGroqApiKeyValidated";
const DOTFLOW_MODE_KEY = "oeDotflowMode";
const DEFAULT_DOTFLOW_MODE = "inline";
const DOTFLOWS_CACHE_KEY = "oeDotflowsCache"; // chrome.storage.local, written by dotflows.js
const DOTFLOW_NOTES_KEY = "oeDotflowNotes"; // chrome.storage.sync, { [dotflowId]: "note" }
const DEFAULT_WHITELIST = [
  "https://ankiuser.net/study",
  "https://www.openevidence.com/*",
  "http://uptodate.com/*",
  "nejm.org/*",
  "https://accessmedicine.mhmedical.com/*",
  "https://www.clinicalkey.com/*",
  "file:///*"
];
const BUTTON_WIDTH = 154;
const UPTODATE_BUTTON_WIDTH = 110;
const GOOGLE_BUTTON_WIDTH = 96;
const CLOSE_BUTTON_WIDTH = 34;
const PICO_BUTTON_WIDTH = 62;
const CUSTOM_BUTTON_WIDTH = 96;
const BUTTON_HEIGHT = 34;
const BUTTON_GAP = 8;
const VIEWPORT_MARGIN = 10;
const DEFAULT_THEME = "system";

let whitelist = DEFAULT_WHITELIST;
let groqKeyValidated = false;
let customPrompts = [];
let theme = DEFAULT_THEME;
let dotflows = [];
let dotflowMode = DEFAULT_DOTFLOW_MODE;
let dotflowNotes = {}; // user-maintained short notes, keyed by dotflow id
let selectedDotflowId = ""; // persists across toolbars so the choice sticks
let toolbar = null;
let resultPanel = null;
let selectedText = "";
let hideTimer = null;
let removeToolbarTimer = null;
const colorSchemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

function normalizeUrlPattern(pattern) {
  return pattern.trim().replace(/\/+$/, "");
}

function patternMatchesValue(pattern, value) {
  if (pattern.includes("*")) {
    const escaped = pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${escaped}`).test(value);
  }

  return value === pattern || value.startsWith(`${pattern}/`) || value.startsWith(`${pattern}?`);
}

function isWhitelisted(url, patterns) {
  return patterns.some((pattern) => {
    const normalized = normalizeUrlPattern(pattern);
    if (!normalized) {
      return false;
    }

    if (/^[a-z][a-z\d+.-]*:\/\//i.test(normalized)) {
      return patternMatchesValue(normalized, url);
    }

    try {
      const pageUrl = new URL(url);
      const hostPath = `${pageUrl.hostname}${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`;
      const bareHostPath = hostPath.replace(/^www\./, "");

      return patternMatchesValue(normalized, hostPath) || patternMatchesValue(normalized, bareHostPath);
    } catch (_error) {
      return false;
    }
  });
}

function loadWhitelist() {
  chrome.storage.sync.get(
    {
      [STORAGE_KEY]: DEFAULT_WHITELIST,
      [CUSTOM_PROMPTS_STORAGE_KEY]: [],
      [THEME_STORAGE_KEY]: DEFAULT_THEME,
      [DOTFLOW_MODE_KEY]: DEFAULT_DOTFLOW_MODE,
      [DOTFLOW_NOTES_KEY]: {}
    },
    (items) => {
      const value = items[STORAGE_KEY];
      whitelist = Array.isArray(value) && value.length > 0 ? value : DEFAULT_WHITELIST;
      customPrompts = normalizeCustomPrompts(items[CUSTOM_PROMPTS_STORAGE_KEY]);
      theme = normalizeTheme(items[THEME_STORAGE_KEY]);
      dotflowMode = items[DOTFLOW_MODE_KEY] === "official" ? "official" : "inline";
      dotflowNotes = items[DOTFLOW_NOTES_KEY] && typeof items[DOTFLOW_NOTES_KEY] === "object"
        ? items[DOTFLOW_NOTES_KEY]
        : {};
    }
  );
}

function loadGroqStatus() {
  chrome.storage.local.get({ [GROQ_VALIDATED_STORAGE_KEY]: false }, (items) => {
    groqKeyValidated = items[GROQ_VALIDATED_STORAGE_KEY] === true;
  });
}

function loadDotflows() {
  chrome.runtime.sendMessage({ type: "OE_FETCH_DOTFLOWS" }, (response) => {
    if (chrome.runtime.lastError) {
      return;
    }
    if (response?.ok && Array.isArray(response.dotflows)) {
      dotflows = response.dotflows;
    }
  });
}

// Mirror the sidepanel: inline (default) prepends the dotflow prompt text;
// official sends the raw question + a dotflowId the background turns into the
// URL param that the MAIN-world interceptor uses on POST /api/article.
function buildDotflowQuery(rawQuery) {
  const flow = selectedDotflowId ? dotflows.find((d) => d.id === selectedDotflowId) : null;
  if (!flow) {
    return { query: rawQuery, dotflowId: "", dotflowName: "" };
  }
  if (dotflowMode === "official") {
    return { query: rawQuery, dotflowId: flow.id, dotflowName: flow.name };
  }
  const query = flow.explanation_prompt
    ? `${flow.explanation_prompt}\n\n---\n\n${rawQuery}`
    : rawQuery;
  return { query, dotflowId: "", dotflowName: flow.name };
}

function removeButton() {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  if (removeToolbarTimer) {
    window.clearTimeout(removeToolbarTimer);
    removeToolbarTimer = null;
  }

  if (!toolbar) {
    return;
  }

  const currentToolbar = toolbar;
  toolbar = null;
  currentToolbar.classList.add("oe-selection-toolbar--exit");
  removeToolbarTimer = window.setTimeout(() => {
    currentToolbar.remove();
    removeToolbarTimer = null;
  }, 90);
}

function removeButtonImmediately() {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  if (removeToolbarTimer) {
    window.clearTimeout(removeToolbarTimer);
    removeToolbarTimer = null;
  }

  toolbar?.remove();
  toolbar = null;
}

function removeResultPanel() {
  resultPanel?.remove();
  resultPanel = null;
}

function getSelectionText() {
  const text = window.getSelection()?.toString().replace(/\s+/g, " ").trim() || "";
  return text.length > 0 ? text : "";
}

function getSelectionRect() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length === 0) {
    const rect = range.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? rect : null;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function getButtonPosition() {
  const selectionRect = getSelectionRect();
  if (!selectionRect) {
    return null;
  }

  const customButtonCount = groqKeyValidated ? customPrompts.length : 0;
  const toolbarWidth =
    Math.min(
      window.innerWidth - VIEWPORT_MARGIN * 2,
      BUTTON_WIDTH +
        BUTTON_GAP +
        UPTODATE_BUTTON_WIDTH +
        BUTTON_GAP +
        GOOGLE_BUTTON_WIDTH +
        (groqKeyValidated ? BUTTON_GAP + PICO_BUTTON_WIDTH : 0) +
        customButtonCount * (BUTTON_GAP + CUSTOM_BUTTON_WIDTH) +
        BUTTON_GAP +
        CLOSE_BUTTON_WIDTH
    );
  const centeredLeft = selectionRect.left + selectionRect.width / 2 - toolbarWidth / 2;
  const maxLeft = window.innerWidth - toolbarWidth - VIEWPORT_MARGIN;
  const left = Math.min(Math.max(VIEWPORT_MARGIN, centeredLeft), maxLeft);
  const preferredTop = selectionRect.top - BUTTON_HEIGHT - BUTTON_GAP;
  const fallbackTop = selectionRect.bottom + BUTTON_GAP;
  const top = preferredTop >= VIEWPORT_MARGIN ? preferredTop : fallbackTop;

  return {
    left,
    top: Math.min(Math.max(VIEWPORT_MARGIN, top), window.innerHeight - BUTTON_HEIGHT - VIEWPORT_MARGIN)
  };
}

function getPanelPosition() {
  const selectionRect = getSelectionRect();
  if (!selectionRect) {
    return null;
  }

  const panelWidth = Math.min(620, window.innerWidth - VIEWPORT_MARGIN * 2);
  const centeredLeft = selectionRect.left + selectionRect.width / 2 - panelWidth / 2;
  const left = Math.min(Math.max(VIEWPORT_MARGIN, centeredLeft), window.innerWidth - panelWidth - VIEWPORT_MARGIN);
  const top = Math.min(
    Math.max(VIEWPORT_MARGIN, selectionRect.bottom + BUTTON_GAP),
    window.innerHeight - 260 - VIEWPORT_MARGIN
  );

  return { left, top, width: panelWidth };
}

function openQuery(query, meta, dotflow) {
  const nextQuery = typeof query === "string" ? query.trim() : "";
  if (nextQuery) {
    const message = { type: "OE_OPEN_QUERY", query: nextQuery };
    if (meta) {
      message.meta = meta;
    }
    if (dotflow?.dotflowId) {
      message.dotflowId = dotflow.dotflowId;
    }
    if (dotflow?.dotflowName) {
      message.dotflowName = dotflow.dotflowName;
    }
    chrome.runtime.sendMessage(message);
  }
}

function openUpToDate(query) {
  const nextQuery = typeof query === "string" ? query.trim() : "";
  if (nextQuery) {
    chrome.runtime.sendMessage({ type: "OE_OPEN_UPTODATE", query: nextQuery });
  }
}

function openGoogle(query) {
  const nextQuery = typeof query === "string" ? query.trim() : "";
  if (nextQuery) {
    chrome.runtime.sendMessage({ type: "OE_OPEN_GOOGLE", query: nextQuery });
  }
}

function normalizeTheme(value) {
  return ["system", "light", "dark"].includes(value) ? value : DEFAULT_THEME;
}

function getResolvedTheme() {
  if (theme === "system") {
    return colorSchemeQuery?.matches ? "dark" : "light";
  }

  return theme;
}

function applyTheme(element) {
  if (!element) {
    return;
  }

  element.dataset.oeTheme = getResolvedTheme();
}

function applyThemeToUi() {
  applyTheme(toolbar);
  applyTheme(resultPanel);
}

function normalizeCustomPrompts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      name: typeof item?.name === "string" ? item.name.trim() : "",
      prompt: typeof item?.prompt === "string" ? item.prompt.trim() : ""
    }))
    .filter((item) => item.name && item.prompt)
    .slice(0, 6);
}

function makeToolbarButton(className, text, title) {
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = className;
  nextButton.title = title;
  nextButton.setAttribute("aria-label", title);

  const icon = createLucideIcon(getButtonIconName(text));
  const label = document.createElement("span");
  label.textContent = text;
  nextButton.append(icon, label);

  nextButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  return nextButton;
}

function formatDotflowLabel(df, note) {
  const base = df.is_default ? `${df.name} ✓` : df.name;
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (!trimmed) {
    return base;
  }
  const short = trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
  return `${base} — ${short}`;
}

function populateDotflowOptions(picker) {
  picker.textContent = "";

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No dotflow";
  picker.appendChild(none);

  for (const df of dotflows) {
    const opt = document.createElement("option");
    opt.value = df.id;
    opt.textContent = formatDotflowLabel(df, dotflowNotes[df.id]);
    if (dotflowNotes[df.id]) {
      opt.title = dotflowNotes[df.id];
    }
    picker.appendChild(opt);
  }

  // Keep the prior choice if it still exists; otherwise fall back to "No dotflow".
  picker.value = dotflows.some((d) => d.id === selectedDotflowId) ? selectedDotflowId : "";
  selectedDotflowId = picker.value;
}

// Repopulate the picker of a currently-open toolbar so a fresh dotflow catalog
// shows up without a page reload.
function refreshOpenDotflowPicker() {
  const picker = toolbar?.querySelector(".oe-selection-dotflow");
  if (picker) {
    populateDotflowOptions(picker);
  }
}

function makeDotflowPicker() {
  const picker = document.createElement("select");
  picker.className = "oe-selection-dotflow";
  picker.title = "Apply a Dotflow to this question";
  picker.setAttribute("aria-label", "Dotflow");

  populateDotflowOptions(picker);

  // Native <select> must keep its default behaviour to open, so DON'T
  // preventDefault here (that would block the dropdown) — only stop the toolbar's
  // own handlers from firing. The selectionchange guard (uiHasFocus) keeps the
  // toolbar alive while the picker steals focus and collapses the text selection.
  picker.addEventListener("mousedown", (event) => event.stopPropagation());
  picker.addEventListener("click", (event) => event.stopPropagation());
  picker.addEventListener("change", (event) => {
    event.stopPropagation();
    selectedDotflowId = picker.value;
  });

  return picker;
}

function getButtonIconName(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes("ask")) {
    return "search";
  }
  if (normalized === "uptodate") {
    return "book-open";
  }
  if (normalized === "google") {
    return "globe";
  }
  if (normalized === "reload") {
    return "rotate-cw";
  }
  if (normalized === "pico") {
    return "shell";
  }
  if (normalized === "copy" || normalized === "copied") {
    return "copy";
  }
  if (normalized === "close") {
    return "x";
  }

  return "sparkles";
}

function createLucideIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "oe-lucide-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const paths = {
    copy: [
      '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>',
      '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
    ],
    search: ['<circle cx="11" cy="11" r="8"/>', '<path d="m21 21-4.3-4.3"/>'],
    "book-open": [
      '<path d="M12 7v14"/>',
      '<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'
    ],
    globe: [
      '<circle cx="12" cy="12" r="10"/>',
      '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>',
      '<path d="M2 12h20"/>'
    ],
    "rotate-cw": [
      '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>',
      '<path d="M21 3v5h-5"/>'
    ],
    "circle-x": [
      '<circle cx="12" cy="12" r="10"/>',
      '<path d="m15 9-6 6"/>',
      '<path d="m9 9 6 6"/>'
    ],
    shell: [
      '<path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 12 12 0 0 1 24 0"/>',
      '<path d="M12 11v11"/>'
    ],
    sparkles: [
      '<path d="M9.9 4.2 8.8 7.3a2 2 0 0 1-1.2 1.2L4.5 9.6l3.1 1.1a2 2 0 0 1 1.2 1.2l1.1 3.1 1.1-3.1a2 2 0 0 1 1.2-1.2l3.1-1.1-3.1-1.1a2 2 0 0 1-1.2-1.2Z"/>',
      '<path d="M18 3v4"/>',
      '<path d="M20 5h-4"/>',
      '<path d="M19 17v3"/>',
      '<path d="M20.5 18.5h-3"/>'
    ],
    "wand-sparkles": [
      '<path d="m21.6 11.6-8.2 8.2a2.1 2.1 0 0 1-3-3l8.2-8.2a2.1 2.1 0 0 1 3 3Z"/>',
      '<path d="m15.5 10.5 3 3"/>',
      '<path d="M5 3v4"/>',
      '<path d="M7 5H3"/>',
      '<path d="M9 15v4"/>',
      '<path d="M11 17H7"/>'
    ],
    x: ['<path d="M18 6 6 18"/>', '<path d="m6 6 12 12"/>']
  };

  svg.innerHTML = paths[name]?.join("") || paths.sparkles.join("");
  return svg;
}

function ensureToolbar() {
  if (toolbar) {
    return toolbar;
  }

  toolbar = document.createElement("div");
  toolbar.className = "oe-selection-toolbar";
  applyTheme(toolbar);

  const askButton = makeToolbarButton(
    "oe-selection-button oe-selection-button--ask",
    "Ask OpenEvidence",
    "Open selection in OpenEvidence"
  );

  askButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const raw = selectedText || getSelectionText();
    const built = buildDotflowQuery(raw);
    removeButton();
    openQuery(built.query, undefined, built);
  });

  toolbar.appendChild(askButton);

  if (dotflows.length > 0) {
    toolbar.appendChild(makeDotflowPicker());
  }

  const upToDateButton = makeToolbarButton(
    "oe-selection-button oe-selection-button--uptodate",
    "UpToDate",
    "Search the selection on UpToDate"
  );

  upToDateButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const query = selectedText || getSelectionText();
    removeButton();
    openUpToDate(query);
  });

  toolbar.appendChild(upToDateButton);

  const googleButton = makeToolbarButton(
    "oe-selection-button oe-selection-button--google",
    "Google",
    "Search the selection on Google"
  );

  googleButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const query = selectedText || getSelectionText();
    removeButton();
    openGoogle(query);
  });

  toolbar.appendChild(googleButton);

  if (groqKeyValidated) {
    const picoButton = makeToolbarButton(
      "oe-selection-button oe-selection-button--pico",
      "PICO",
      "Rewrite selection as an EBM foreground question"
    );

    picoButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      generatePicoQuestion();
    });

    toolbar.appendChild(picoButton);

    customPrompts.forEach((customPrompt) => {
      const customButton = makeToolbarButton(
        "oe-selection-button oe-selection-button--custom",
        customPrompt.name,
        customPrompt.prompt
      );

      customButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        generateCustomPrompt(customPrompt);
      });

      toolbar.appendChild(customButton);
    });
  }

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "oe-selection-button oe-selection-button--close";
  closeButton.title = "Close";
  closeButton.setAttribute("aria-label", "Close toolbar");
  closeButton.append(createLucideIcon("circle-x"));
  closeButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeButtonImmediately();
  });
  toolbar.appendChild(closeButton);

  document.documentElement.appendChild(toolbar);
  startTrackingUi();
  return toolbar;
}

function renderPicoSkeleton() {
  if (!resultPanel) {
    return;
  }

  resultPanel.innerHTML = `
    <div class="oe-pico-panel__skeleton" aria-label="Generating PICO question">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;
}

function ensureResultPanel() {
  removeResultPanel();

  const position = getPanelPosition();
  if (!position) {
    return null;
  }

  resultPanel = document.createElement("div");
  resultPanel.className = "oe-pico-panel";
  applyTheme(resultPanel);
  resultPanel.style.left = `${position.left}px`;
  resultPanel.style.top = `${position.top}px`;
  resultPanel.style.width = `${position.width}px`;
  renderPicoSkeleton();

  resultPanel.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });

  document.documentElement.appendChild(resultPanel);
  startTrackingUi();
  return resultPanel;
}

function reloadTransform(meta) {
  if (!resultPanel || !meta?.original) {
    return;
  }

  renderPicoSkeleton();

  const message =
    meta.source === "custom"
      ? { type: "OE_GENERATE_CUSTOM_PROMPT", selection: meta.original, prompt: meta.promptInstruction }
      : { type: "OE_GENERATE_PICO", selection: meta.original };

  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      renderPicoError(chrome.runtime.lastError.message);
      return;
    }

    if (!response?.ok) {
      renderPicoError(response?.error || "Unable to regenerate the output");
      return;
    }

    renderPicoResult(response.content, {
      ...meta,
      promptInstruction: meta.promptInstruction || response.prompt
    });
  });
}

function renderPicoResult(content, meta) {
  if (!resultPanel) {
    return;
  }

  resultPanel.innerHTML = "";

  const textarea = document.createElement("textarea");
  textarea.className = "oe-pico-panel__editor";
  textarea.value = content;
  textarea.rows = 6;
  textarea.setAttribute("aria-label", "Editable PICO question");

  const actions = document.createElement("div");
  actions.className = "oe-pico-panel__actions";

  const askButton = makeToolbarButton(
    "oe-pico-panel__button oe-pico-panel__button--primary",
    "Ask OpenEvidence",
    "Ask OpenEvidence with edited PICO question"
  );
  askButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openQuery(textarea.value, meta ? { ...meta, transformed: content } : undefined);
    removeResultPanel();
  });

  const copyButton = makeToolbarButton("oe-pico-panel__button", "Copy", "Copy generated output");
  copyButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(textarea.value);
      copyButton.querySelector("span").textContent = "Copied";
      window.setTimeout(() => {
        copyButton.querySelector("span").textContent = "Copy";
      }, 1400);
    } catch (_error) {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      copyButton.querySelector("span").textContent = "Copied";
      window.setTimeout(() => {
        copyButton.querySelector("span").textContent = "Copy";
      }, 1400);
    }
  });

  const closeButton = makeToolbarButton("oe-pico-panel__button", "Close", "Close PICO editor");
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeResultPanel();
  });

  if (meta?.original) {
    const reloadButton = makeToolbarButton("oe-pico-panel__button", "Reload", "Regenerate the output");
    reloadButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      reloadTransform(meta);
    });
    actions.append(reloadButton, copyButton, askButton, closeButton);
  } else {
    actions.append(copyButton, askButton, closeButton);
  }

  resultPanel.append(textarea, actions);
  textarea.focus();
}

function renderPicoError(message) {
  if (!resultPanel) {
    return;
  }

  resultPanel.innerHTML = "";

  const error = document.createElement("p");
  error.className = "oe-pico-panel__error";
  error.textContent = message;

  const closeButton = makeToolbarButton("oe-pico-panel__button", "Close", "Close PICO error");
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeResultPanel();
  });

  resultPanel.append(error, closeButton);
}

function generatePicoQuestion() {
  const selection = selectedText || getSelectionText();
  if (!selection) {
    removeButton();
    return;
  }

  removeButton();
  const panel = ensureResultPanel();
  if (!panel) {
    return;
  }

  chrome.runtime.sendMessage({ type: "OE_GENERATE_PICO", selection }, (response) => {
    if (chrome.runtime.lastError) {
      renderPicoError(chrome.runtime.lastError.message);
      return;
    }

    if (!response?.ok) {
      renderPicoError(response?.error || "Unable to generate the PICO question");
      return;
    }

    renderPicoResult(response.content, {
      source: "pico",
      original: selection,
      promptName: "PICO",
      promptInstruction: response.prompt
    });
  });
}

function generateCustomPrompt(customPrompt) {
  const selection = selectedText || getSelectionText();
  if (!selection) {
    removeButton();
    return;
  }

  removeButton();
  const panel = ensureResultPanel();
  if (!panel) {
    return;
  }

  chrome.runtime.sendMessage(
    {
      type: "OE_GENERATE_CUSTOM_PROMPT",
      selection,
      prompt: customPrompt.prompt
    },
    (response) => {
      if (chrome.runtime.lastError) {
        renderPicoError(chrome.runtime.lastError.message);
        return;
      }

      if (!response?.ok) {
        renderPicoError(response?.error || `Unable to run ${customPrompt.name}`);
        return;
      }

      renderPicoResult(response.content, {
        source: "custom",
        original: selection,
        promptName: customPrompt.name,
        promptInstruction: customPrompt.prompt
      });
    }
  );
}

function showButton() {
  if (!isWhitelisted(window.location.href, whitelist)) {
    removeButton();
    return;
  }

  selectedText = getSelectionText();
  if (!selectedText) {
    removeButton();
    return;
  }

  const nextButton = ensureToolbar();
  const position = getButtonPosition();
  if (!position) {
    removeButton();
    return;
  }

  nextButton.style.left = `${position.left}px`;
  nextButton.style.top = `${position.top}px`;

  if (hideTimer) {
    window.clearTimeout(hideTimer);
  }
  hideTimer = window.setTimeout(removeButton, 12000);
}

function repositionUi() {
  if (toolbar) {
    const position = getButtonPosition();
    if (position) {
      toolbar.style.left = `${position.left}px`;
      toolbar.style.top = `${position.top}px`;
    }
  }

  if (resultPanel) {
    const position = getPanelPosition();
    if (position) {
      resultPanel.style.left = `${position.left}px`;
      resultPanel.style.top = `${position.top}px`;
      resultPanel.style.width = `${position.width}px`;
    }
  }
}

// The toolbar and result panel are position: fixed and anchored to the
// selection's viewport rect. Relying on scroll events to re-anchor them lags at
// the start of a scroll, because passive scroll events are coalesced/delayed
// while the compositor scrolls (and on busy host pages). Instead, track on every
// animation frame while the UI is visible — like Floating UI autoUpdate's
// animationFrame mode — so it stays glued through scroll, nested scroll, resize,
// zoom, and layout shifts with no event-delivery latency. The loop stops itself
// once both surfaces are gone.
let trackFrame = null;
let lastRectKey = "";

function trackSelectionUi() {
  trackFrame = null;

  if (!toolbar && !resultPanel) {
    lastRectKey = "";
    return;
  }

  const rect = getSelectionRect();
  const rectKey = rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : "";
  if (rectKey !== lastRectKey) {
    lastRectKey = rectKey;
    repositionUi();
  }

  trackFrame = window.requestAnimationFrame(trackSelectionUi);
}

function startTrackingUi() {
  if (trackFrame === null) {
    lastRectKey = "";
    trackFrame = window.requestAnimationFrame(trackSelectionUi);
  }
}

// True while focus is inside our toolbar — e.g. the native dotflow <select> is
// open. Opening it collapses the page selection, which would otherwise trip the
// selectionchange teardown below and yank the toolbar away mid-interaction.
function uiHasFocus() {
  const active = document.activeElement;
  return Boolean(toolbar && active && toolbar.contains(active));
}

document.addEventListener("mouseup", showButton, true);
document.addEventListener("selectionchange", () => {
  if (!getSelectionText() && !uiHasFocus()) {
    removeButton();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    removeButton();
    removeResultPanel();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync") {
    if (changes[STORAGE_KEY]) {
      const nextValue = changes[STORAGE_KEY].newValue;
      whitelist = Array.isArray(nextValue) && nextValue.length > 0 ? nextValue : DEFAULT_WHITELIST;
    }

    if (changes[CUSTOM_PROMPTS_STORAGE_KEY]) {
      customPrompts = normalizeCustomPrompts(changes[CUSTOM_PROMPTS_STORAGE_KEY].newValue);
      removeButtonImmediately();
    }

    if (changes[THEME_STORAGE_KEY]) {
      theme = normalizeTheme(changes[THEME_STORAGE_KEY].newValue);
      applyThemeToUi();
    }

    if (changes[DOTFLOW_MODE_KEY]) {
      dotflowMode = changes[DOTFLOW_MODE_KEY].newValue === "official" ? "official" : "inline";
    }

    if (changes[DOTFLOW_NOTES_KEY]) {
      const next = changes[DOTFLOW_NOTES_KEY].newValue;
      dotflowNotes = next && typeof next === "object" ? next : {};
      refreshOpenDotflowPicker();
    }

    return;
  }

  if (areaName === "local") {
    if (changes[GROQ_VALIDATED_STORAGE_KEY]) {
      groqKeyValidated = changes[GROQ_VALIDATED_STORAGE_KEY].newValue === true;
      removeButtonImmediately();
    }

    // dotflows.js refreshed its cache (TTL expiry / new fetch) — pick up the new
    // catalog live so an already-open tab/toolbar sees added dotflows without a reload.
    if (changes[DOTFLOWS_CACHE_KEY]) {
      const next = changes[DOTFLOWS_CACHE_KEY].newValue;
      if (next && Array.isArray(next.data)) {
        dotflows = next.data;
        refreshOpenDotflowPicker();
      }
    }
  }
});

loadWhitelist();
loadGroqStatus();
loadDotflows();

colorSchemeQuery?.addEventListener("change", () => {
  if (theme === "system") {
    applyThemeToUi();
  }
});

