// OpenAI — chat completions. Requires OPENAI_API_KEY in env.
// Model defaults to gpt-4o-mini for cost; override with LLM_MODEL.

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.LLM_MODEL || '{{LLM_MODEL}}';

export async function callLlm(system: string, user: string): Promise<string | null> {
  if (!API_KEY) {
    console.warn('[openai] OPENAI_API_KEY is not set');
    return null;
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
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
    console.warn(`[openai] HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? null;
}
