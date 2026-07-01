// MAIN-world, document_start. Path A: officially activate a dotflow by injecting
// `dotflow: { id }` into the POST that OpenEvidence fires when a question is
// submitted via /ask?query=...&oe_ext_dotflow_id=<id>.
//
// OE may submit via window.fetch OR XMLHttpRequest, and via either fetch call
// style. We patch all of them. Logs use console.log/warn (visible at the default
// DevTools level) and print every POST URL seen, so the real endpoint is
// discoverable even if it isn't /api/article.
(function () {
  const params = new URLSearchParams(location.search);
  const dotflowId = params.get("oe_ext_dotflow_id");
  if (!dotflowId) return;

  const TAG = "[oe-dotflow]";
  // High-volume per-POST tracing is off by default; append &oe_ext_debug=1 to the
  // /ask URL (or flip this constant) to surface which endpoints OE actually hits.
  const DEBUG = params.get("oe_ext_debug") === "1";
  const trace = (...a) => DEBUG && console.log(TAG, ...a);
  const ARTICLE_RE = /\/api\/article/;
  let done = false;

  function injectDotflow(bodyText) {
    const body = JSON.parse(bodyText); // throws -> caller keeps original body
    if (!body || typeof body !== "object") return bodyText;
    // Confirmed via captured POST /api/article: the real schema nests dotflow
    // under `inputs` ({ article_type, inputs: { question, dotflow: { id } }, ... }).
    // Target inputs when present; fall back to top level only if the shape differs.
    const target = body.inputs && typeof body.inputs === "object" ? body.inputs : body;
    if (!target.dotflow || typeof target.dotflow !== "object") {
      target.dotflow = { id: dotflowId };
    } else if (!target.dotflow.id) {
      target.dotflow.id = dotflowId;
    }
    const out = JSON.stringify(body);
    trace("final body:", out);
    return out;
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const isRequest = typeof Request !== "undefined" && input instanceof Request;
      const url = isRequest
        ? input.url
        : typeof input === "string"
          ? input
          : (input && input.url) || "";
      const method = (
        (init && init.method) || (isRequest && input.method) || "GET"
      ).toUpperCase();

      if (method === "POST") trace("fetch POST seen:", url);

      if (!done && method === "POST" && ARTICLE_RE.test(url)) {
        if (init && typeof init.body === "string") {
          done = true;
          window.fetch = origFetch;
          try {
            const newBody = injectDotflow(init.body);
            console.log(TAG, "✅ injected via fetch(init.body)", dotflowId);
            return origFetch(input, Object.assign({}, init, { body: newBody }));
          } catch (e) {
            console.warn(TAG, "fetch init.body parse failed", e);
            return origFetch.apply(this, arguments);
          }
        }
        if (isRequest) {
          done = true;
          window.fetch = origFetch;
          const self = this;
          const args = arguments;
          return input
            .clone()
            .text()
            .then((text) => {
              try {
                const newBody = injectDotflow(text);
                console.log(TAG, "✅ injected via fetch(Request)", dotflowId);
                return origFetch(new Request(input, { body: newBody }));
              } catch (e) {
                console.warn(TAG, "fetch Request body parse failed", e);
                return origFetch.apply(self, args);
              }
            });
        }
      }
    } catch (e) {
      console.warn(TAG, "fetch interceptor error", e);
    }
    return origFetch.apply(this, arguments);
  };

  // ---- XMLHttpRequest ----
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__oeMethod = String(method || "").toUpperCase();
      this.__oeUrl = String(url || "");
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      try {
        if (this.__oeMethod === "POST") trace("xhr POST seen:", this.__oeUrl);
        if (!done && this.__oeMethod === "POST" && ARTICLE_RE.test(this.__oeUrl) && typeof body === "string") {
          done = true;
          try {
            const newBody = injectDotflow(body);
            console.log(TAG, "✅ injected via XHR", dotflowId);
            return origSend.call(this, newBody);
          } catch (e) {
            console.warn(TAG, "xhr body parse failed", e);
          }
        }
      } catch (e) {
        console.warn(TAG, "xhr interceptor error", e);
      }
      return origSend.apply(this, arguments);
    };
  }

  console.log(TAG, "armed for dotflow", dotflowId, "on", location.href);
})();
