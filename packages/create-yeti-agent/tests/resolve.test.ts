import { resolveBaseUrl, explainNetworkError, PRIMARY_BASE_URL, FALLBACK_BASE_URL, Fetcher } from '../src/resolve';

const ok: Fetcher = async () => ({ ok: true, status: 200 });
const tls: Fetcher = async () => { throw new Error("Hostname/IP does not match certificate's altnames"); };
const http503: Fetcher = async () => ({ ok: false, status: 503 });
const hang: Fetcher = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));

describe('resolveBaseUrl', () => {
  test('primary healthy -> primary, no fallback', async () => {
    expect(await resolveBaseUrl(undefined, { fetcher: ok })).toEqual({ baseUrl: PRIMARY_BASE_URL, fellBack: false });
  });
  test('TLS error -> fallback', async () => {
    const r = await resolveBaseUrl(undefined, { fetcher: tls });
    expect(r.baseUrl).toBe(FALLBACK_BASE_URL);
    expect(r.fellBack).toBe(true);
    expect(r.reason).toMatch(/altnames/);
  });
  test('non-2xx -> fallback', async () => {
    const r = await resolveBaseUrl(undefined, { fetcher: http503 });
    expect(r).toMatchObject({ baseUrl: FALLBACK_BASE_URL, fellBack: true, reason: 'HTTP 503' });
  });
  test('timeout -> fallback', async () => {
    const r = await resolveBaseUrl(undefined, { fetcher: hang, timeoutMs: 20 });
    expect(r.fellBack).toBe(true);
    expect(r.reason).toMatch(/timeout/);
  });
  test('explicit URL is never probed or replaced', async () => {
    const fetcher = jest.fn(tls);
    const r = await resolveBaseUrl('http://localhost:3001/', { fetcher });
    expect(r).toEqual({ baseUrl: 'http://localhost:3001', fellBack: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('explainNetworkError suggests --url', () => {
    expect(explainNetworkError('https://x', new Error('ECONNREFUSED')).message).toMatch(/--url/);
    expect(explainNetworkError('https://x', new Error('/api/arena/join failed (400): bad')).message).toMatch(/400/);
  });
});
