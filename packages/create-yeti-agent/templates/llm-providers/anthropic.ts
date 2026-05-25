// Anthropic Claude — direct REST. Requires ANTHROPIC_API_KEY in env.
// Model defaults to claude-sonnet-4-6; override with LLM_MODEL.

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LLM_MODEL || '{{LLM_MODEL}}';

export async function callLlm(system: string, user: string): Promise<string | null> {
  if (!API_KEY) {
    console.warn('[anthropic] ANTHROPIC_API_KEY is not set');
    return null;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    console.warn(`[anthropic] HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }
  const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const block = body.content?.find((c) => c.type === 'text');
  return block?.text ?? null;
}
