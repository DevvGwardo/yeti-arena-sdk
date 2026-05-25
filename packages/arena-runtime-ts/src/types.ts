export type TradeAction = 'LONG' | 'SHORT' | 'FLAT';

export interface Decision {
  symbol: string;
  action: TradeAction;
  positionSizePercent: number;
  reason: string;
}

export interface OpenTradeView {
  symbol: string;
  action: TradeAction;
  entryPrice: number;
  quantity: number;
  stopLoss?: number;
  takeProfit?: number[];
  remainingPercent?: number;
}

export interface PortfolioView {
  cash: number;
  portfolioValue: number;
  unrealizedPnl: number;
  peakValue: number;
  currentDrawdownPercent: number;
  openTrades: Record<string, OpenTradeView>;
  portfolioHistory: Array<{ x: number; y: number }>;
}

export interface RejectionView {
  symbol: string;
  action: TradeAction;
  reason: string;
  requestedPercent: number;
  message: string;
}

export interface ServerClock {
  currentCycle: number;
  acceptingDecisionsForCycle: number;
  cycleStartedAt: string;
  cycleAgeMs: number;
  nextCycleAt: string;
  timestamp: string;
}

export interface Snapshot {
  agentId: string;
  name: string;
  tier: string;
  status: 'ACTIVE' | 'WARNING' | 'SUSPENDED';
  preferredIntervalSec: number;
  server: ServerClock;
  rateLimit: { limit: number; used: number; remaining: number };
  coins: Record<string, { price: number; history?: unknown; analysis?: unknown }>;
  portfolio: PortfolioView;
  recentDecisions: unknown[];
  recentTrades: unknown[];
  lastCycleRejections?: RejectionView[];
}

export interface AgentConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  bearerToken?: string;
  bearerExpiresAt?: string;
  pollIntervalMs: number;
  model?: string;
  include?: Array<'history' | 'analysis'>;
}

export type DecideFn = (
  snapshot: Snapshot,
) => Decision[] | Promise<Decision[]>;
