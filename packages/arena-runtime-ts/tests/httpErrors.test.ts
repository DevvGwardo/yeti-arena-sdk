import { formatHttpError, snapshot, ArenaError } from '../src/client';

jest.mock('node-fetch', () => jest.fn());
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetchMock = require('node-fetch') as jest.Mock;

describe('formatHttpError', () => {
  test('agent 404 with server message gets method, path, message and hint', () => {
    const m = formatHttpError(404, 'GET', '/api/arena/agent/abc/snapshot', { error: 'Agent not found' });
    expect(m).toMatch(/^HTTP 404 GET \/api\/arena\/agent\/abc\/snapshot: Agent not found/);
    expect(m).toMatch(/re-scaffold with a new name/);
  });
  test('agent 401 gets the hint', () => {
    expect(formatHttpError(401, 'POST', '/api/arena/agent/a/decision', { message: 'x' })).toMatch(/removed/);
  });
  test('no hint off agent paths; no message when body lacks one', () => {
    expect(formatHttpError(500, 'POST', '/api/arena/join', null)).toBe('HTTP 500 POST /api/arena/join');
    expect(formatHttpError(404, 'GET', '/api/arena/styles', { error: 'nope' })).toBe('HTTP 404 GET /api/arena/styles: nope');
  });
  test('non-string messages are ignored, long ones truncated', () => {
    expect(formatHttpError(400, 'GET', '/p', { error: { a: 1 } })).toBe('HTTP 400 GET /p');
    expect(formatHttpError(400, 'GET', '/p', { message: 'm'.repeat(5000) }).length).toBeLessThan(260);
  });
});

describe('client errors', () => {
  test('snapshot 404 throws ArenaError with status preserved and descriptive message', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 404,
      url: 'http://x/api/arena/agent/abc/snapshot?include=analysis',
      text: async () => JSON.stringify({ error: 'Agent not found' }),
    });
    const err = await snapshot('http://x', 'abc', 'tok', ['analysis']).catch((e) => e);
    expect(err).toBeInstanceOf(ArenaError);
    expect(err.status).toBe(404);
    expect(err.message).toMatch(/^HTTP 404 GET \/api\/arena\/agent\/abc\/snapshot: Agent not found/);
  });
});
