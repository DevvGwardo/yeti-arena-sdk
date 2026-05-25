import { SDK_HEADER, SDK_HEADER_VALUE, ArenaError } from '../src/client';
import { defineAgent } from '../src/index';

describe('SDK header contract', () => {
  test('header name is the documented x-yeti-sdk', () => {
    expect(SDK_HEADER).toBe('x-yeti-sdk');
  });

  test('header value follows <pkg>@<version> shape the backend gate validates', () => {
    expect(SDK_HEADER_VALUE).toMatch(/^@yetifi\/arena-runtime@\d+\.\d+\.\d+/);
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
