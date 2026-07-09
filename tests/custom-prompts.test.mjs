import assert from "node:assert/strict";

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

// The full prompt sent to Groq is simply the selection followed by the
// custom prompt — no JSON-transform wrapper.
function buildCustomPrompt(userPrompt, selection) {
  return `${selection}\n\n${userPrompt}`;
}

assert.deepEqual(normalizeCustomPrompts([{ name: " Summary ", prompt: " Summarize " }, { name: "", prompt: "x" }]), [
  { name: "Summary", prompt: "Summarize" }
]);
assert.equal(normalizeCustomPrompts(new Array(8).fill({ name: "A", prompt: "B" })).length, 6);
assert.equal(buildCustomPrompt("Explain clinically", "MPN treatment"), "MPN treatment\n\nExplain clinically");
