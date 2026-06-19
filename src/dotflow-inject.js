(function () {
  const dotflowId = new URLSearchParams(location.search).get("oe_ext_dotflow_id");
  if (!dotflowId) return;

  const origFetch = window.fetch;
  let intercepted = false;

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!intercepted && url.includes("/api/article") && init && init.method === "POST" && init.body) {
      intercepted = true;
      window.fetch = origFetch;
      try {
        const body = JSON.parse(init.body);
        if (!body.dotflow) body.dotflow = { id: dotflowId };
        return origFetch(input, Object.assign({}, init, { body: JSON.stringify(body) }));
      } catch (e) {}
    }
    return origFetch.apply(this, arguments);
  };
})();
