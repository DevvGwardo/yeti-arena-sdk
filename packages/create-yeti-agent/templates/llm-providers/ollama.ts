// Ollama — local model runtime, default http://127.0.0.1:11434.
// Override with LLM_BASE_URL / LLM_MODEL in .env.local.

const BASE_URL = process.env.LLM_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.LLM_MODEL || '{{LLM_MODEL}}';

export async function callLlm(system: string, user: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: { temperature: 0.4 },
    }),
  });
  if (!res.ok) {
    console.warn(`[ollama] HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }
  const body = (await res.json()) as { message?: { content?: string } };
  return body.message?.content ?? null;
}
