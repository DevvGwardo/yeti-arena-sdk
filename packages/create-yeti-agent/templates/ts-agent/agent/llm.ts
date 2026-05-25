// Stub fallback: no LLM provider was detected at scaffold time, so this
// implementation always returns null and decide.ts will return [] every
// cycle (the agent holds positions). Replace this file by either:
//
//   1. Re-running `create-yeti-agent` after setting an API key (e.g.
//      `export ANTHROPIC_API_KEY=...`) — the next scaffold auto-wires.
//   2. Copy-pasting one of the provider variants the package ships
//      (see node_modules/create-yeti-agent/templates/llm-providers/).
//
// Or hand-write your own callLlm — any function returning the LLM's raw
// string response works; decide.ts handles JSON extraction + validation.

export async function callLlm(_system: string, _user: string): Promise<string | null> {
  return null;
}
