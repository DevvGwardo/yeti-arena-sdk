import type { Decision, Snapshot } from '../src/types';

const submitMock = jest.fn();
const snapshotMock = jest.fn();

jest.mock('../src/client', () => ({
  snapshot: (...args: unknown[]) => snapshotMock(...args),
  submit: (...args: unknown[]) => submitMock(...args),
  ArenaError: class ArenaError extends Error {
    status: number;
    payload: unknown;
    constructor(status: number, payload: unknown, message: string) {
      super(message);
      this.status = status;
      this.payload = payload;
      this.name = 'ArenaError';
    }
  },
}));

jest.mock('../src/auth', () => ({
  TokenManager: class {
    async get() {
      return 'tok';
    }
    invalidate() {}
  },
}));

import { runLive } from '../src/loop';

const baseSnap = (overrides: Partial<Snapshot> = {}): Snapshot =>
  ({
    agentId: 'a1',
    name: 'bot',
    tier: 'free',
    status: 'ACTIVE',
    preferredIntervalSec: 60,
    server: {
      currentCycle: 1,
      acceptingDecisionsForCycle: 2,
      cycleStartedAt: '2026-07-13T00:00:00Z',
      cycleAgeMs: 100,
      nextCycleAt: '2026-07-13T00:01:00Z',
      timestamp: '2026-07-13T00:00:00Z',
    },
    rateLimit: { limit: 120, used: 0, remaining: 120 },
    coins: { ETH: { price: 3000 }, BTC: { price: 100000 } },
    portfolio: {
      cash: 10_000,
      portfolioValue: 10_000,
      unrealizedPnl: 0,
      peakValue: 10_000,
      currentDrawdownPercent: 0,
      openTrades: {},
      portfolioHistory: [],
    },
    recentDecisions: [],
    recentTrades: [],
    readiness: {
      phase: 'QUEUE',
      gated: true,
      agentReady: false,
      readyCount: 0,
      minAgents: 3,
      action: 'submit a decision',
    },
    ...overrides,
  }) as Snapshot;

describe('runLive QUEUE heartbeat', () => {
  beforeEach(() => {
    submitMock.mockReset();
    snapshotMock.mockReset();
    submitMock.mockResolvedValue({ accepted: true, targetCycle: 2, replaced: false });
  });

  async function runOnce(snap: Snapshot, decide: () => Decision[]) {
    snapshotMock.mockResolvedValue(snap);
    await runLive(
      {
        baseUrl: 'http://x',
        agentId: 'a1',
        apiKey: 'k',
        pollIntervalMs: 1,
        bearerToken: 'tok',
        bearerExpiresAt: '2099-01-01T00:00:00Z',
      },
      decide,
      { maxCycles: 1 },
    );
  }

  test('QUEUE + [] → submits synthetic FLAT heartbeat', async () => {
    await runOnce(baseSnap(), () => []);
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock.mock.calls[0][3]).toEqual({
      decisions: [
        {
          symbol: 'ETH',
          action: 'FLAT',
          positionSizePercent: 0,
          reason: 'queue readiness heartbeat',
        },
      ],
      model: 'runtime-queue-heartbeat',
    });
  });

  test('LIVE + [] → does not submit', async () => {
    await runOnce(
      baseSnap({
        readiness: { phase: 'LIVE', gated: false, agentReady: true, action: 'go' },
      }),
      () => [],
    );
    expect(submitMock).not.toHaveBeenCalled();
  });

  test('QUEUE + real decisions → submits those, not synthetic', async () => {
    const real: Decision[] = [
      { symbol: 'BTC', action: 'LONG', positionSizePercent: 10, reason: 'edge' },
    ];
    await runOnce(baseSnap(), () => real);
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock.mock.calls[0][3].decisions).toEqual(real);
  });
});
