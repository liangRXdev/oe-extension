export const DOTFLOWS_ENDPOINT =
  "https://www.openevidence.com/api/dotflows/dot-flows?limit=100&offset=0";
export const DOTFLOWS_CACHE_KEY = "oeDotflowsCache";
const DOTFLOWS_CACHE_TTL_MS = 30 * 60 * 1000;

function normalizeDotflow(raw) {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: typeof raw.name === "string" ? raw.name : "",
    explanation_prompt: typeof raw.explanation_prompt === "string" ? raw.explanation_prompt : "",
    is_default: raw.is_default === true
  };
}

export async function fetchDotflows() {
  const stored = await chrome.storage.local.get({ [DOTFLOWS_CACHE_KEY]: null });
  const cached = stored[DOTFLOWS_CACHE_KEY];
  if (
    cached &&
    typeof cached.ts === "number" &&
    Date.now() - cached.ts < DOTFLOWS_CACHE_TTL_MS &&
    Array.isArray(cached.data)
  ) {
    return cached.data;
  }

  const response = await fetch(DOTFLOWS_ENDPOINT, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to fetch dotflows: HTTP ${response.status}`);
  }

  const json = await response.json();
  const items = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.results)
        ? json.results
        : [];

  const normalized = items.map(normalizeDotflow).filter((d) => d.id && d.name);

  await chrome.storage.local.set({
    [DOTFLOWS_CACHE_KEY]: { ts: Date.now(), data: normalized }
  });

  return normalized;
}

export function applyDotflow(query, dotflowName) {
  if (!dotflowName) return query;
  return `${dotflowName} ${query}`;
}
