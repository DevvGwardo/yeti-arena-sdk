import fetch from 'node-fetch';

export type Provider = 'hermes' | 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'stub';

export interface Detection {
  provider: Provider;
  // Display name surfaced in CLI output and AGENTS.md. Falls back to the
  // provider key when the LLM endpoint doesn't volunteer a model name.
  model?: string;
  // Local-LLM base URL (Hermes, Ollama). Cloud providers ignore this.
  baseUrl?: string;
  // Reason a provider was chosen / skipped, only set when explanation helps.
  reason?: string;
}

// Short, bounded probe so a slow or offline endpoint can never wedge the
// scaffolder. 1.5s is generous for localhost loopback; loopback responses
// land in <50ms in practice.
const PROBE_TIMEOUT_MS = 1500;

const PROVIDERS_IN_ORDER: Provider[] = [
  'hermes',
  'anthropic',
  'openai',
  'gemini',
  'ollama',
];

interface ProbeResult {
  ok: boolean;
  status: number;
  body: unknown | null;
}

async function probeJson(url: string, headers?: Record<string, string>): Promise<ProbeResult> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal as AbortSignal, headers });
    const text = await res.text().catch(() => '');
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(t);
  }
}

async function detectHermes(): Promise<Detection | null> {
  // Hermes serves an OpenAI-compatible API on 127.0.0.1:8642 by default.
  // Many Hermes builds gate /v1/models behind an API key — try unauth
  // first, retry with HERMES_API_KEY on 401 so a locked local install
  // still resolves without forcing the user to disable auth.
  let res = await probeJson('http://127.0.0.1:8642/v1/models');
  if (!res.ok && res.status === 401 && process.env.HERMES_API_KEY) {
    res = await probeJson('http://127.0.0.1:8642/v1/models', {
      authorization: `Bearer ${process.env.HERMES_API_KEY}`,
    });
  }
  if (!res.ok) {
    if (res.status === 401) {
      // Hermes is up but no usable key was found — surface a hint so the
      // user knows their local model is one env-var away from being wired.
      // eslint-disable-next-line no-console
      console.warn('  hermes is running on :8642 but locked — set HERMES_API_KEY to use it (falling through to next provider)');
    }
    return null;
  }
  const data = res.body as { data?: Array<{ id?: string }> } | null;
  if (!data || !Array.isArray(data.data) || data.data.length === 0) return null;
  const model = data.data[0]?.id || 'hermes';
  return { provider: 'hermes', model, baseUrl: 'http://127.0.0.1:8642' };
}

function detectAnthropic(): Detection | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return { provider: 'anthropic', model: 'claude-sonnet-4-6' };
}

function detectOpenAI(): Detection | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return { provider: 'openai', model: 'gpt-4o-mini' };
}

function detectGemini(): Detection | null {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) return null;
  return { provider: 'gemini', model: 'gemini-2.0-flash' };
}

async function detectOllama(): Promise<Detection | null> {
  const res = await probeJson('http://127.0.0.1:11434/api/tags');
  if (!res.ok) return null;
  const data = res.body as { models?: Array<{ name?: string }> } | null;
  if (!data || !Array.isArray(data.models) || data.models.length === 0) return null;
  // Prefer a chat-capable model name when multiple are pulled. The first one
  // is usually the most recently pulled and is good enough as a default.
  const model = data.models[0]?.name || 'llama3';
  return { provider: 'ollama', model, baseUrl: 'http://127.0.0.1:11434' };
}

const DETECTORS: Record<Exclude<Provider, 'stub'>, () => Promise<Detection | null> | (Detection | null)> = {
  hermes: detectHermes,
  anthropic: detectAnthropic,
  openai: detectOpenAI,
  gemini: detectGemini,
  ollama: detectOllama,
};

export async function detectProvider(): Promise<Detection> {
  for (const p of PROVIDERS_IN_ORDER) {
    const fn = DETECTORS[p as Exclude<Provider, 'stub'>];
    const out = await Promise.resolve(fn());
    if (out) return out;
  }
  return { provider: 'stub', reason: 'No LLM provider detected — wired decide.ts returns [] every cycle. Edit it to add a strategy.' };
}

// Override path: --llm <name> on the CLI. Validates name + returns the same
// Detection shape, with model/baseUrl set to sensible defaults so the
// template wiring still works without a probe. Throws on unknown name.
export function overrideProvider(name: string): Detection {
  const key = name.trim().toLowerCase();
  switch (key) {
    case 'hermes':    return { provider: 'hermes', model: 'hermes', baseUrl: 'http://127.0.0.1:8642' };
    case 'anthropic': return { provider: 'anthropic', model: 'claude-sonnet-4-6' };
    case 'openai':    return { provider: 'openai', model: 'gpt-4o-mini' };
    case 'gemini':    return { provider: 'gemini', model: 'gemini-2.0-flash' };
    case 'ollama':    return { provider: 'ollama', model: 'llama3', baseUrl: 'http://127.0.0.1:11434' };
    case 'stub':      return { provider: 'stub' };
    default:
      throw new Error(`Unknown --llm value: "${name}". Valid: hermes, anthropic, openai, gemini, ollama, stub.`);
  }
}
