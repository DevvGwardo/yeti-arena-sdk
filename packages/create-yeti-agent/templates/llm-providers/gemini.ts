// Google Gemini — generateContent REST. Requires GEMINI_API_KEY (or
// GOOGLE_API_KEY) in env. Model defaults to gemini-2.0-flash.

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const MODEL = process.env.LLM_MODEL || '{{LLM_MODEL}}';

export async function callLlm(system: string, user: string): Promise<string | null> {
  if (!API_KEY) {
    console.warn('[gemini] GEMINI_API_KEY (or GOOGLE_API_KEY) is not set');
    return null;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    console.warn(`[gemini] HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    return null;
  }
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}
