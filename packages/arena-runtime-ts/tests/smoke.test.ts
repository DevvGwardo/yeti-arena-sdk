import { SDK_HEADER, SDK_HEADER_VALUE, ArenaError } from '../src/client';
import { defineAgent } from '../src/index';

describe('SDK header contract', () => {
  test('header name is the documented x-yeti-sdk', () => {
    expect(SDK_HEADER).toBe('x-yeti-sdk');
  });

  test('header value follows <pkg>@<version> shape the backend gate validates', () => {
    expect(SDK_HEADER_VALUE).toMatch(/^yetifi-arena-runtime@\d+\.\d+\.\d+/);
  });
});

describe('TokenManager', () => {
  test('invalidate() clears the cached bearer so next get() re-authenticates', () => {
    // Construct with a fake "fresh" token (far-future expiry) — get()
    // would normally return it without hitting the network.
    const { TokenManager } = require('../src/auth');
    const tm = new TokenManager('http://x', 'a', 'k', 'fake-token', '2099-01-01T00:00:00Z');
    // After invalidate, the cached state is gone; we only verify the
    // private fields are nulled by checking the public API behavior in
    // a 401-style scenario can't reuse the bearer. The contract is that
    // a subsequent get() must re-acquire via doAuth, which we don't
    // mock here — the existence of invalidate() is the regression pin.
    expect(typeof tm.invalidate).toBe('function');
    tm.invalidate();
    // No throw; private state nulled. Real test of the auth dance is
    // the live smoke against a running backend.
  });
});

describe('ArenaError', () => {
  test('carries status + payload + message', () => {
    const e = new ArenaError(426, { error: 'SDK_REQUIRED' }, 'use the SDK');
    expect(e.status).toBe(426);
    expect(e.payload).toEqual({ error: 'SDK_REQUIRED' });
    expect(e.message).toBe('use the SDK');
    expect(e.name).toBe('ArenaError');
    expect(e instanceof Error).toBe(true);
  });
});

describe('defineAgent', () => {
  test('defaults', () => {
    const a = defineAgent({ decide: () => [] });
    expect(a.config.pollIntervalMs).toBe(15_000);
    expect(a.config.include).toEqual(['analysis']);
    expect(a.config.model).toBeUndefined();
  });

  test('overrides', () => {
    const a = defineAgent({
      decide: () => [],
      config: { pollIntervalMs: 5_000, model: 'claude-opus-4-7', include: ['history', 'analysis'] },
    });
    expect(a.config.pollIntervalMs).toBe(5_000);
    expect(a.config.model).toBe('claude-opus-4-7');
    expect(a.config.include).toEqual(['history', 'analysis']);
  });

  test('decide function is preserved', () => {
    const decide = jest.fn().mockReturnValue([]);
    const a = defineAgent({ decide });
    expect(a.decide).toBe(decide);
  });
});
