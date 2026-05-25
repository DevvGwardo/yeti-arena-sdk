// Rules — fetches /api/arena/manifest and caches the contract the server
// enforces. Used by decide.ts to embed exact limits into the LLM prompt
// and by guardrails.ts to compute per-cycle safe sizing.
//
// The manifest is the single source of truth — never hand-roll these
// numbers in your strategy code. If the server changes a limit (e.g.
// maxDecisionsPerCycle goes from 3 → 5), this file picks it up at the
// next refresh and the LLM sees the new ceiling without a redeploy.

const REFRESH_MS = 5 * 60_000;

export interface ArenaRules {
  startingCapital: number;
  maxPositionSizePercent: number;
  maxTotalExposurePercent: number;
  maxDecisionsPerCycle: number;
  requestsPerMinute: number;
  drawdownWarningPercent: number;
  drawdownSuspendedPercent: number;
  reasonMaxChars: number;
  cycleIntervalSec: number;
  actions: string[];
  flatClosesPosition: boolean;
  symbolsOmittedHoldExistingPosition: boolean;
  stopLossAndTakeProfitAreServerSide: boolean;
}

export interface DecisionSchema {
  symbolEnum: string[];
  actionEnum: string[];
  positionSizeMin: number;
  positionSizeMax: number;
  reasonMaxLength: number;
}

export interface ManifestSnapshot {
  rules: ArenaRules;
  schema: DecisionSchema;
  supportedSymbols: string[];
  fetchedAt: number;
}

interface Cache {
  data: ManifestSnapshot | null;
  inFlight: Promise<ManifestSnapshot> | null;
}

const cache: Cache = { data: null, inFlight: null };

function baseUrl(): string {
  const u = process.env.ARENA_BASE_URL || 'https://api.hermesarena.live';
  return u.replace(/\/$/, '');
}

async function fetchManifest(): Promise<ManifestSnapshot> {
  const res = await fetch(`${baseUrl()}/api/arena/manifest`);
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
  const m = (await res.json()) as {
    rules: ArenaRules;
    supportedSymbols: string[];
    schemas: { Decision: { properties: { symbol: { enum: string[] }; action: { enum: string[] }; positionSizePercent: { minimum: number; maximum: number }; reason: { maxLength: number } } } };
  };
  const schema: DecisionSchema = {
    symbolEnum: m.schemas.Decision.properties.symbol.enum,
    actionEnum: m.schemas.Decision.properties.action.enum,
    positionSizeMin: m.schemas.Decision.properties.positionSizePercent.minimum,
    positionSizeMax: m.schemas.Decision.properties.positionSizePercent.maximum,
    reasonMaxLength: m.schemas.Decision.properties.reason.maxLength,
  };
  return {
    rules: m.rules,
    schema,
    supportedSymbols: m.supportedSymbols,
    fetchedAt: Date.now(),
  };
}

export async function getRules(): Promise<ManifestSnapshot> {
  const now = Date.now();
  if (cache.data && now - cache.data.fetchedAt < REFRESH_MS) return cache.data;
  if (cache.inFlight) return cache.inFlight;

  cache.inFlight = (async () => {
    try {
      const fresh = await fetchManifest();
      cache.data = fresh;
      return fresh;
    } catch (err) {
      // If the manifest is unreachable but we have a stale cache, prefer
      // the stale data over throwing — the cycle should never die because
      // of a transient manifest miss. If we have nothing cached, fall back
      // to compiled-in defaults that match the server validators today.
      if (cache.data) {
        console.warn('[rules] manifest refresh failed, using stale cache:', err instanceof Error ? err.message : err);
        return cache.data;
      }
      console.warn('[rules] manifest unreachable, using safe defaults:', err instanceof Error ? err.message : err);
      return DEFAULTS;
    } finally {
      cache.inFlight = null;
    }
  })();
  return cache.inFlight;
}

// Conservative fallback used when /manifest is unreachable on first call.
// Matches the values getArenaRuleLimits() returns from
// state/arenaAgentState.ts as of yetifi-arena-runtime 0.1.3. If these
// drift from the server, the manifest path will correct them on the
// next successful fetch — these are last-resort defaults only.
const DEFAULTS: ManifestSnapshot = {
  rules: {
    startingCapital: 10_000,
    maxPositionSizePercent: 100,
    maxTotalExposurePercent: 100,
    maxDecisionsPerCycle: 3,
    requestsPerMinute: 120,
    drawdownWarningPercent: 15,
    drawdownSuspendedPercent: 20,
    reasonMaxChars: 280,
    cycleIntervalSec: 60,
    actions: ['LONG', 'SHORT', 'FLAT'],
    flatClosesPosition: true,
    symbolsOmittedHoldExistingPosition: true,
    stopLossAndTakeProfitAreServerSide: true,
  },
  schema: {
    symbolEnum: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT'],
    actionEnum: ['LONG', 'SHORT', 'FLAT'],
    positionSizeMin: 0,
    positionSizeMax: 100,
    reasonMaxLength: 280,
  },
  supportedSymbols: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT'],
  fetchedAt: 0,
};
