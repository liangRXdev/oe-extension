import assert from "node:assert/strict";

// Mirrors pickSidebarAction in src/oe-sidepane.js: decides what to do from the
// toggle aria-labels currently in the DOM.
//   "collapse" -> an expanded sidebar toggle exists, click it
//   "done"     -> the sidebar is already collapsed, stop watching
//   "wait"     -> no toggle rendered yet, keep polling
const SIDEBAR_COLLAPSED_LABEL = "Open sidebar";
const SIDEBAR_EXPANDED_LABEL = "Close sidebar";

function pickSidebarAction(labels) {
  if (labels.includes(SIDEBAR_EXPANDED_LABEL)) {
    return "collapse";
  }
  if (labels.includes(SIDEBAR_COLLAPSED_LABEL)) {
    return "done";
  }
  return "wait";
}

// Expanded sidebar -> collapse it.
assert.equal(pickSidebarAction(["Close sidebar"]), "collapse");
assert.equal(pickSidebarAction(["Open menu", "Close sidebar", "Open navigation menu"]), "collapse");

// Already collapsed -> nothing to do.
assert.equal(pickSidebarAction(["Open sidebar"]), "done");
assert.equal(pickSidebarAction(["Open menu", "Open sidebar"]), "done");

// Toggle not rendered yet (OE still hydrating) -> keep polling.
assert.equal(pickSidebarAction([]), "wait");
assert.equal(pickSidebarAction(["Open menu", "Open navigation menu"]), "wait");

// Expanded label wins even if a stale collapsed label is also present.
assert.equal(pickSidebarAction(["Open sidebar", "Close sidebar"]), "collapse");

console.log("sidepane-sidebar: all assertions passed");
