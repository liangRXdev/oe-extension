import assert from "node:assert/strict";

// Mirrors buildRedirectUrl in src/nccn-redirect.js: turns an NCCN guideline PDF
// link into the user's own viewer URL, or returns null when the link isn't one
// of those PDFs (or no template is configured).
const NCCN_PDF_PATTERN =
  /^https?:\/\/(?:[^/]+\.)?nccn\.org\/professionals\/physician_gls\/pdf\/([^/?#]+)\.pdf(?=[?#]|$)/i;
const NCCN_PAGE_PATTERN = /(?:^|[&;])page=(\d+)/i;

function buildRedirectUrl(href, template) {
  if (typeof href !== "string" || typeof template !== "string" || !template.trim()) {
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
    .replace(/\$(cancer|page)/g, (_token, name) => (name === "cancer" ? cancer : page));
}

const WEB_TEMPLATE = "https://nccn.hsiehting.com/preview/$cancer?page=$page";
const FILE_TEMPLATE = "file:///Users/htlin/Downloads/NCCN/$cancer.pdf#page=$page";

// Guideline slug and page are both carried over.
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/b-cell.pdf#page=114", WEB_TEMPLATE),
  "https://nccn.hsiehting.com/preview/b-cell?page=114"
);

// No #page fragment -> page 1.
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf", WEB_TEMPLATE),
  "https://nccn.hsiehting.com/preview/nscl?page=1"
);

// A query string before the fragment is ignored.
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf?utm=oe#page=42", WEB_TEMPLATE),
  "https://nccn.hsiehting.com/preview/nscl?page=42"
);

// http:// and a bare (or other) host prefix still match.
assert.equal(
  buildRedirectUrl("http://nccn.org/professionals/physician_gls/pdf/breast.pdf#page=7", WEB_TEMPLATE),
  "https://nccn.hsiehting.com/preview/breast?page=7"
);

// Extra fragment keys around #page= are tolerated.
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf#page=114&zoom=100", WEB_TEMPLATE),
  "https://nccn.hsiehting.com/preview/nscl?page=114"
);
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf#zoom=100&page=114", WEB_TEMPLATE),
  "https://nccn.hsiehting.com/preview/nscl?page=114"
);

// A "page" that isn't its own fragment key must not be picked up.
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf#lastpage=9", WEB_TEMPLATE),
  "https://nccn.hsiehting.com/preview/nscl?page=1"
);
// A page= in the query string is not the fragment either.
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf?page=9", WEB_TEMPLATE),
  "https://nccn.hsiehting.com/preview/nscl?page=1"
);

// file:// templates work the same way.
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/b-cell.pdf#page=114", FILE_TEMPLATE),
  "file:///Users/htlin/Downloads/NCCN/b-cell.pdf#page=114"
);

// Repeated variables are all replaced.
assert.equal(
  buildRedirectUrl(
    "https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf#page=9",
    "https://x.test/$cancer/$page/$cancer"
  ),
  "https://x.test/nscl/9/nscl"
);

// Not an NCCN guideline PDF -> no redirect.
assert.equal(buildRedirectUrl("https://www.openevidence.com/ask/abc", WEB_TEMPLATE), null);
assert.equal(buildRedirectUrl("https://www.nccn.org/guidelines/category_1", WEB_TEMPLATE), null);
assert.equal(buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.html", WEB_TEMPLATE), null);
// ".pdf" has to end the path, not just appear inside it.
assert.equal(
  buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf.zip", WEB_TEMPLATE),
  null
);
// A host that merely ends in the same letters must not match.
assert.equal(
  buildRedirectUrl("https://evilnccn.org/professionals/physician_gls/pdf/nscl.pdf", WEB_TEMPLATE),
  null
);

// Missing or blank template -> no redirect (nothing to rewrite to).
assert.equal(buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf", ""), null);
assert.equal(buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf", "   "), null);
assert.equal(buildRedirectUrl("https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf", null), null);
assert.equal(buildRedirectUrl(null, WEB_TEMPLATE), null);

console.log("nccn-redirect: all assertions passed");
