// Collapses OpenEvidence's own left navigation sidebar when the page is shown
// inside the extension's side panel. The side panel is narrow, so OE's sidebar
// wastes the little horizontal space the question view has. A full-tab
// OpenEvidence (the top frame) is left untouched — only the embedded iframe
// inside our side panel runs this collapse.
//
// OE's toggle button reports its state through aria-label:
//   "Open sidebar"  -> sidebar is collapsed (nothing to do)
//   "Close sidebar" -> sidebar is expanded  (click to collapse)
//
// OE persists the expanded/collapsed state in localStorage["sidenavExpanded"],
// which is shared per-origin with the full-tab OpenEvidence. So after we collapse
// THIS frame via the real toggle, we restore that flag to its previous value:
// the side panel's DOM stays collapsed (React state already flipped, and a
// same-document write fires no storage event here), while a full-tab OpenEvidence
// still reads the user's own preference on its next mount. That keeps the side
// pane tidy without changing what the full tab does.

const SIDEBAR_COLLAPSED_LABEL = "Open sidebar";
const SIDEBAR_EXPANDED_LABEL = "Close sidebar";
const SIDENAV_STORAGE_KEY = "sidenavExpanded";
const COLLAPSE_POLL_INTERVAL_MS = 250;
const COLLAPSE_TIMEOUT_MS = 8000;
// OE may persist the new state on a microtask/debounce after the click, so we
// restore the flag a few times to land after that write.
const RESTORE_DELAYS_MS = [200, 600, 1200];

// Pure decision from the toggle labels currently in the DOM:
//   "collapse" -> an expanded toggle exists, click it
//   "done"     -> the sidebar is already collapsed, stop watching
//   "wait"     -> no toggle rendered yet, keep polling
function pickSidebarAction(labels) {
  if (labels.includes(SIDEBAR_EXPANDED_LABEL)) {
    return "collapse";
  }
  if (labels.includes(SIDEBAR_COLLAPSED_LABEL)) {
    return "done";
  }
  return "wait";
}

function getToggleButtons() {
  return [...document.querySelectorAll("button[aria-label]")];
}

function readSidenavFlag() {
  try {
    return window.localStorage.getItem(SIDENAV_STORAGE_KEY);
  } catch (_error) {
    return null;
  }
}

function writeSidenavFlag(value) {
  try {
    window.localStorage.setItem(SIDENAV_STORAGE_KEY, value);
  } catch (_error) {
    // Ignore — storage may be unavailable; the DOM is already collapsed.
  }
}

// Runs once: returns true when the sidebar state is settled (collapsed by us or
// already collapsed) and the caller can stop polling.
function collapseSidebarOnce() {
  const buttons = getToggleButtons();
  const action = pickSidebarAction(buttons.map((button) => button.getAttribute("aria-label")));

  if (action === "wait") {
    return false;
  }

  if (action === "collapse") {
    const previous = readSidenavFlag();
    buttons.find((button) => button.getAttribute("aria-label") === SIDEBAR_EXPANDED_LABEL)?.click();

    // Put the shared preference back so the full-tab OpenEvidence is untouched.
    if (previous !== null) {
      for (const delay of RESTORE_DELAYS_MS) {
        window.setTimeout(() => writeSidenavFlag(previous), delay);
      }
    }
  }

  return true;
}

function startCollapsing() {
  if (collapseSidebarOnce()) {
    return;
  }

  // OE hydrates asynchronously, so the toggle may not exist at document_idle.
  // Poll until it appears (then settle) or until we give up.
  const deadline = Date.now() + COLLAPSE_TIMEOUT_MS;
  const timer = window.setInterval(() => {
    if (collapseSidebarOnce() || Date.now() >= deadline) {
      window.clearInterval(timer);
    }
  }, COLLAPSE_POLL_INTERVAL_MS);
}

// window.top !== window.self means we're framed — the only place OE is framed in
// this extension is the side panel.
if (typeof window !== "undefined" && window.top !== window.self) {
  startCollapsing();
}
