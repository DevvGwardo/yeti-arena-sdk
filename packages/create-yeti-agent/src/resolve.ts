import fetch from 'node-fetch';

export const PRIMARY_BASE_URL = 'https://api.hermesarena.live';
export const FALLBACK_BASE_URL = 'https://hermes-arena-backend-production-f928.up.railway.app';
export const PROBE_TIMEOUT_MS = 5000;

export type Fetcher = (url: string, init?: { signal?: any }) => Promise<{ ok: boolean; status: number }>;

export interface ResolvedBase {
  baseUrl: string;
  /** True when the primary default was unreachable and the fallback was chosen. */
  fellBack: boolean;
  /** Why the primary probe failed (only when fellBack). */
  reason?: string;
}

const trim = (u: string): string => u.replace(/\/+$/, '');

/** GET <base>/api/arena/manifest with a timeout. Returns null on success, else a reason string. */
export async function probeBase(
  base: string,
  fetcher: Fetcher = fetch as unknown as Fetcher,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${trim(base)}/api/arena/manifest`, { signal: ctrl.signal });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (err) {
    return ctrl.signal.aborted ? `timeout after ${timeoutMs}ms` : (err as Error).message || String(err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Explicit URL (--url / YETI_ARENA_URL) is used verbatim, never probed or
 * replaced. Otherwise probe the primary default and fall back to Railway.
 */
export async function resolveBaseUrl(
  explicit: string | undefined,
  opts: { fetcher?: Fetcher; timeoutMs?: number; primary?: string; fallback?: string } = {},
): Promise<ResolvedBase> {
  if (explicit) return { baseUrl: trim(explicit), fellBack: false };
  const primary = trim(opts.primary ?? PRIMARY_BASE_URL);
  const fallback = trim(opts.fallback ?? FALLBACK_BASE_URL);
  const reason = await probeBase(primary, opts.fetcher, opts.timeoutMs);
  if (reason === null) return { baseUrl: primary, fellBack: false };
  return { baseUrl: fallback, fellBack: true, reason };
}

/** Wrap a network error from an explicitly chosen URL with a helpful hint. */
export function explainNetworkError(baseUrl: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/^\/api\/arena\/|HTTP \d+|\(\d{3}\)/.test(msg)) return err instanceof Error ? err : new Error(msg);
  return new Error(
    `Could not reach ${baseUrl} (${msg}).\n` +
    `  If this host is down or has a bad TLS cert, pass a different one with --url <url> ` +
    `(or set YETI_ARENA_URL).`,
  );
}
