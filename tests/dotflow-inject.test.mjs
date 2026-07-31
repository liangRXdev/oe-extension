// Exercises the real src/dotflow-inject.js (not a copy) inside a minimal fake
// browser built with node:vm — no jsdom, no framework, matching the rest of the
// suite's zero-dependency style.
//
// This is the fork's core feature and it talks to OpenEvidence's private API, so
// the shape assertions below double as the schema record: dotflow goes under
// `inputs`, injection is one-shot, and a body we cannot parse is passed through
// untouched.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, "src", "dotflow-inject.js"), "utf8");

const ARTICLE_URL = "https://www.openevidence.com/api/article";

// Builds a sandbox, runs the injector in it, and returns handles for driving it.
function load(search) {
  const fetchCalls = [];
  const xhrSends = [];

  class Request {
    constructor(input, init = {}) {
      const base = typeof input === "string" ? { url: input } : input;
      this.url = base.url;
      this.method = init.method || base.method || "GET";
      this.body = init.body !== undefined ? init.body : base.body;
    }
    clone() {
      return new Request(this, {});
    }
    text() {
      return Promise.resolve(this.body);
    }
  }

  class XMLHttpRequest {
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send(body) {
      xhrSends.push(body);
    }
  }

  const originalFetch = function (input, init) {
    fetchCalls.push({ input, init });
    return Promise.resolve({ ok: true });
  };

  const window = { fetch: originalFetch, XMLHttpRequest };
  const sandbox = {
    window,
    location: { search, href: "https://www.openevidence.com/ask" + search },
    console: { log() {}, warn() {} },
    URLSearchParams,
    Request,
    XMLHttpRequest
  };
  createContext(sandbox);
  runInContext(source, sandbox);

  return { window, originalFetch, fetchCalls, xhrSends, Request, XMLHttpRequest };
}

const armed = "?query=x&oe_ext_dotflow_id=df-123";

// Reads the body the injector actually handed to the original fetch.
function sentBody(fetchCalls, i = 0) {
  const call = fetchCalls[i];
  const raw = call.init && call.init.body !== undefined ? call.init.body : call.input.body;
  return JSON.parse(raw);
}

// ── 1. No dotflow id in the URL → the page's network layer is left alone ──────
{
  const { window, originalFetch, XMLHttpRequest } = load("?query=x");
  assert.equal(window.fetch, originalFetch, "fetch must not be patched without a dotflow id");
  const xhr = new XMLHttpRequest();
  assert.equal(typeof xhr.send, "function");
}

// ── 2. Confirmed schema: dotflow nests under `inputs` ────────────────────────
{
  const { window, fetchCalls } = load(armed);
  window.fetch(ARTICLE_URL, {
    method: "POST",
    body: JSON.stringify({ article_type: "ask", inputs: { question: "q" } })
  });
  const body = sentBody(fetchCalls);
  assert.deepEqual(body.inputs.dotflow, { id: "df-123" });
  assert.equal(body.inputs.question, "q", "existing inputs fields survive");
  assert.equal(body.dotflow, undefined, "must not also write at top level");
}

// ── 3. Fallback to top level only when `inputs` is absent ────────────────────
{
  const { window, fetchCalls } = load(armed);
  window.fetch(ARTICLE_URL, { method: "POST", body: JSON.stringify({ question: "q" }) });
  const body = sentBody(fetchCalls);
  assert.deepEqual(body.dotflow, { id: "df-123" });
}

// ── 4. A dotflow object already present but id-less gets filled in ───────────
{
  const { window, fetchCalls } = load(armed);
  window.fetch(ARTICLE_URL, {
    method: "POST",
    body: JSON.stringify({ inputs: { question: "q", dotflow: { note: "keep" } } })
  });
  const body = sentBody(fetchCalls);
  assert.equal(body.inputs.dotflow.id, "df-123");
  assert.equal(body.inputs.dotflow.note, "keep");
}

// ── 5. An id the page already set wins — we never overwrite it ───────────────
{
  const { window, fetchCalls } = load(armed);
  window.fetch(ARTICLE_URL, {
    method: "POST",
    body: JSON.stringify({ inputs: { dotflow: { id: "page-owned" } } })
  });
  assert.equal(sentBody(fetchCalls).inputs.dotflow.id, "page-owned");
}

// ── 6. Non-matching endpoints and non-POST traffic are untouched ─────────────
{
  const { window, fetchCalls } = load(armed);
  const other = JSON.stringify({ inputs: { question: "q" } });
  window.fetch("https://www.openevidence.com/api/telemetry", { method: "POST", body: other });
  window.fetch(ARTICLE_URL, { method: "GET" });
  assert.equal(fetchCalls[0].init.body, other, "unrelated POST body must pass through verbatim");
  assert.equal(fetchCalls[1].init.body, undefined);
}

// ── 7. Unparseable body → original request goes out unchanged, no throw ──────
{
  const { window, fetchCalls } = load(armed);
  assert.doesNotThrow(() =>
    window.fetch(ARTICLE_URL, { method: "POST", body: "<html>not json</html>" })
  );
  assert.equal(fetchCalls[0].init.body, "<html>not json</html>");
}

// ── 8. One-shot: fetch is restored and later posts are left alone ────────────
{
  const { window, originalFetch, fetchCalls } = load(armed);
  window.fetch(ARTICLE_URL, { method: "POST", body: JSON.stringify({ inputs: {} }) });
  assert.equal(window.fetch, originalFetch, "patch must be removed after the first hit");

  const second = JSON.stringify({ inputs: { question: "second" } });
  window.fetch(ARTICLE_URL, { method: "POST", body: second });
  assert.equal(fetchCalls[1].init.body, second, "second submit must not be injected");
}

// ── 9. Request-style fetch(new Request(...)) is also covered ─────────────────
{
  const { window, fetchCalls, Request } = load(armed);
  const req = new Request(ARTICLE_URL, {
    method: "POST",
    body: JSON.stringify({ inputs: { question: "q" } })
  });
  await window.fetch(req);
  assert.deepEqual(sentBody(fetchCalls).inputs.dotflow, { id: "df-123" });
}

// ── 10. XHR path injects too — OE may submit either way ─────────────────────
{
  const { xhrSends, XMLHttpRequest } = load(armed);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", ARTICLE_URL);
  xhr.send(JSON.stringify({ inputs: { question: "q" } }));
  assert.deepEqual(JSON.parse(xhrSends[0]).inputs.dotflow, { id: "df-123" });
}

// ── 11. The one-shot flag is shared: fetch wins, XHR then stays out ─────────
{
  const { window, xhrSends, XMLHttpRequest } = load(armed);
  window.fetch(ARTICLE_URL, { method: "POST", body: JSON.stringify({ inputs: {} }) });

  const xhr = new XMLHttpRequest();
  xhr.open("POST", ARTICLE_URL);
  const body = JSON.stringify({ inputs: { question: "q" } });
  xhr.send(body);
  assert.equal(xhrSends[0], body, "XHR must not double-inject after fetch already did");
}

// ── 12. XHR on an unrelated endpoint is untouched ───────────────────────────
{
  const { xhrSends, XMLHttpRequest } = load(armed);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "https://www.openevidence.com/api/telemetry");
  const body = JSON.stringify({ inputs: {} });
  xhr.send(body);
  assert.equal(xhrSends[0], body);
}

console.log("dotflow-inject.test.mjs passed");
