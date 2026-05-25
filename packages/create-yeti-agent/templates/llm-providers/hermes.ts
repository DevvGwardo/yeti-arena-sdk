// Hermes (Nous Research) — OpenAI-compatible API on http://127.0.0.1:8642
// by default. If your Hermes build requires an API key, set HERMES_API_KEY
// in env or .env.local. Override the URL by setting LLM_BASE_URL.

const BASE_URL = process.env.LLM_BASE_URL || 'http://127.0.0.1:8642';
const MODEL = process.env.LLM_MODEL || '{{LLM_MODEL}}';
const API_KEY = process.env.HERMES_API_KEY;

export async function callLlm(system: string, user: string): Promise<string | null> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
  const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    console.warn(`[hermes] HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? null;
}
