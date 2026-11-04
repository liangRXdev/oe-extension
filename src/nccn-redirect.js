// Redirects NCCN guideline PDF links on OpenEvidence to the viewer the user
// configured (a web viewer, or a local file:// copy).
//
// This runs in every OpenEvidence frame — the full tab AND the OpenEvidence
// iframe inside our side panel — so the two places behave the same. The side
// panel is what a plain page-level redirector can't reach: it has no tab of its
// own, and chrome.tabs is unavailable to a content script anyway, so clicks are
// handed to the service worker, which opens the viewer in a new tab. That also
// keeps the side pane parked on the OE conversation instead of navigating it
// away to a PDF.

const NCCN_ENABLED_STORAGE_KEY = "oeNccnRedirectEnabled";
const NCCN_TEMPLATE_STORAGE_KEY = "oeNccnUrlTemplate";
const DEFAULT_NCCN_ENABLED = true;
const DEFAULT_NCCN_TEMPLATE =
	"https://nccn.hsiehting.com/preview/$cancer?page=$page";

// Only the guideline PDF route matches: the host needs a real dot before
// nccn.org so a look-alike domain can't slip through, and ".pdf" must end the
// path rather than merely appear in it.
const NCCN_PDF_PATTERN =
	/^https?:\/\/(?:[^/]+\.)?nccn\.org\/professionals\/physician_gls\/pdf\/([^/?#]+)\.pdf(?=[?#]|$)/i;
// The page lives in the fragment, which OE may pair with other keys.
const NCCN_PAGE_PATTERN = /(?:^|[&;])page=(\d+)/i;

// Pure: the viewer URL for an NCCN PDF link, or null when this href isn't one
// (or no template is configured). Mirrored by tests/nccn-redirect.test.mjs.
function buildRedirectUrl(href, template) {
	if (
		typeof href !== "string" ||
		typeof template !== "string" ||
		!template.trim()
	) {
		return null;
	}

	const match = href.match(NCCN_PDF_PATTERN);
	if (!match) {
		return null;
	}

	const cancer = match[1];
	const hashIndex = href.indexOf("#");
	const fragment = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
	const page = fragment.match(NCCN_PAGE_PATTERN)?.[1] || "1";

	// One pass so a slug that happens to contain "$page" can't be re-substituted.
	return template
		.trim()
		.replace(/\$(cancer|page)/g, (_token, name) =>
			name === "cancer" ? cancer : page,
		);
}

let enabled = DEFAULT_NCCN_ENABLED;
let template = DEFAULT_NCCN_TEMPLATE;

function redirectFor(href) {
	return enabled ? buildRedirectUrl(href, template) : null;
}

// Rewrites the visible hrefs so hovering shows the real destination and
// middle-click / cmd-click land on the viewer too (the click listener below only
// covers plain left clicks).
function updateLinks() {
	for (const link of document.querySelectorAll('a[href*="nccn.org"]')) {
		const nextUrl = redirectFor(link.href);
		if (nextUrl && link.href !== nextUrl) {
			link.dataset.oeNccnOriginal = link.href;
			link.href = nextUrl;
			link.target = "_blank";
		}
	}
}

// Puts back the original nccn.org hrefs — used when the feature is switched off
// or the template is cleared, so the page isn't left pointing at a stale viewer.
function restoreLinks() {
	for (const link of document.querySelectorAll("a[data-oe-nccn-original]")) {
		link.href = link.dataset.oeNccnOriginal;
		delete link.dataset.oeNccnOriginal;
	}
}

function findAnchor(node) {
	return node instanceof Element ? node.closest("a[href]") : null;
}

// Capture phase: OE's own handlers never see the click, so the PDF never starts
// loading in this frame.
document.addEventListener(
	"click",
	(event) => {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey
		) {
			return;
		}

		const anchor = findAnchor(event.target);
		if (!anchor) {
			return;
		}

		// The href may already be rewritten by updateLinks(); the original is kept
		// on the element so a template change still resolves from the NCCN URL.
		const url = redirectFor(anchor.dataset.oeNccnOriginal || anchor.href);
		if (!url) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		// The service worker owns tab creation — and file:// URLs, which a page
		// can't navigate to on its own.
		chrome.runtime.sendMessage({ type: "OE_OPEN_URL", url });
	},
	true,
);

const observer = new MutationObserver(() => updateLinks());

function applySettings(items) {
	enabled = items[NCCN_ENABLED_STORAGE_KEY] !== false;
	const stored = items[NCCN_TEMPLATE_STORAGE_KEY];
	template =
		typeof stored === "string" && stored.trim()
			? stored
			: DEFAULT_NCCN_TEMPLATE;

	if (enabled) {
		updateLinks();
	} else {
		restoreLinks();
	}
}

chrome.storage.sync.get(
	{
		[NCCN_ENABLED_STORAGE_KEY]: DEFAULT_NCCN_ENABLED,
		[NCCN_TEMPLATE_STORAGE_KEY]: DEFAULT_NCCN_TEMPLATE,
	},
	(items) => {
		applySettings(items);
		observer.observe(document.body, { childList: true, subtree: true });
	},
);

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "sync") {
		return;
	}
	if (
		!changes[NCCN_ENABLED_STORAGE_KEY] &&
		!changes[NCCN_TEMPLATE_STORAGE_KEY]
	) {
		return;
	}

	// A template change has to start from the original NCCN hrefs, not the ones
	// already pointing at the previous viewer.
	restoreLinks();
	applySettings({
		[NCCN_ENABLED_STORAGE_KEY]: changes[NCCN_ENABLED_STORAGE_KEY]
			? changes[NCCN_ENABLED_STORAGE_KEY].newValue
			: enabled,
		[NCCN_TEMPLATE_STORAGE_KEY]: changes[NCCN_TEMPLATE_STORAGE_KEY]
			? changes[NCCN_TEMPLATE_STORAGE_KEY].newValue
			: template,
	});
});
