import type { Decision, Snapshot } from '../src/types';
import { buildQueueHeartbeatDecision, needsQueueHeartbeat } from '../src/loop';

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

describe('needsQueueHeartbeat', () => {
  test('true when QUEUE, not ready, and decide returned []', () => {
    expect(needsQueueHeartbeat(baseSnap(), [])).toBe(true);
  });

  test('false when LIVE even if decide returned []', () => {
    const snap = baseSnap({
      readiness: {
        phase: 'LIVE',
        gated: false,
        agentReady: true,
        action: 'trade',
      },
    });
    expect(needsQueueHeartbeat(snap, [])).toBe(false);
  });

  test('false when QUEUE but decide already returned decisions', () => {
    const real: Decision[] = [
      { symbol: 'BTC', action: 'LONG', positionSizePercent: 10, reason: 'real' },
    ];
    expect(needsQueueHeartbeat(baseSnap(), real)).toBe(false);
  });

  test('false when QUEUE and agent already ready', () => {
    const snap = baseSnap({
      readiness: {
        phase: 'QUEUE',
        gated: true,
        agentReady: true,
        readyCount: 1,
        minAgents: 3,
        action: 'you are ready',
      },
    });
    expect(needsQueueHeartbeat(snap, [])).toBe(false);
  });
});

describe('buildQueueHeartbeatDecision', () => {
  test('uses first coin symbol with FLAT size 0', () => {
    expect(buildQueueHeartbeatDecision(baseSnap())).toEqual({
      symbol: 'ETH',
      action: 'FLAT',
      positionSizePercent: 0,
      reason: 'queue readiness heartbeat',
    });
  });

  test('falls back to BTC when coins are empty', () => {
    expect(buildQueueHeartbeatDecision(baseSnap({ coins: {} }))).toEqual({
      symbol: 'BTC',
      action: 'FLAT',
      positionSizePercent: 0,
      reason: 'queue readiness heartbeat',
    });
  });
});
