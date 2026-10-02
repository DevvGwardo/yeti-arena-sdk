// Bundled, rules-based trading styles for the TypeScript scaffolder. These are
// faithful ports of the Python scaffolder's presets
// (packages/create-yeti-agent-py/styles/fallback.json): same thresholds, sizes
// and ranking, no LLM, no extra dependencies. `decideTs` is the full source of
// the generated agent/decide.ts.
//
// If the backend's GET /api/arena/styles catalog ever ships a `decideTs` field
// for a style, the CLI prefers it (see mergeCatalog); otherwise these win.

export interface TradingStyle {
  id: string;
  label: string;
  blurb: string;
  persona: string;
  decideTs: string;
}

interface Spec {
  id: string;
  label: string;
  blurb: string;
  persona: string;
  summary: string;
  maxDecisions: number;
  sizePct: number;
  /** Extra top-level consts (shared helpers and the style's thresholds). */
  extra?: string;
  /** Body of the per-coin loop: reads `a`, `price`, `symbol`; pushes onto `scored`. */
  body: string;
}

const HEADER = (s: Spec): string => `// ${s.label} style - ${s.summary}
//
// Rules-based: reads snapshot.coins[*].analysis only. No LLM and no API key
// needed. Edit the thresholds below, or replace this file with your own logic.
import type { Snapshot, Decision, TradeAction } from 'yetifi-arena-runtime';

const MAX_DECISIONS = ${s.maxDecisions};
const SIZE_PCT = ${s.sizePct};
${s.extra ?? ''}
interface Analysis {
  trend?: unknown;
  priceChange1m?: unknown;
  priceChange5m?: unknown;
  priceChange15m?: unknown;
  priceChange30m?: unknown;
  priceChange1h?: unknown;
  volatility?: unknown;
  volatilityPct?: unknown;
  recentHigh?: unknown;
  recentLow?: unknown;
  currentPrice?: unknown;
}

interface Candidate {
  score: number;
  symbol: string;
  action: TradeAction;
}

// Missing / null / non-numeric analysis fields read as 0 (the cycle then holds).
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function analysisOf(block: unknown): Analysis {
  const a = (block as { analysis?: unknown } | null)?.analysis;
  return a && typeof a === 'object' ? (a as Analysis) : {};
}

export default async function decide(snapshot: Snapshot): Promise<Decision[]> {
  const coins = snapshot.coins;
  if (!coins || typeof coins !== 'object') return [];

  const scored: Candidate[] = [];
  for (const [symbol, block] of Object.entries(coins)) {
    if (!block || typeof block !== 'object') continue;
    const a = analysisOf(block);
    const trend = typeof a.trend === 'string' && a.trend ? a.trend : 'NEUTRAL';
    const price = num((block as { price?: unknown }).price) || num(a.currentPrice);
    const vol = num(a.volatility ?? a.volatilityPct);
${s.body}
  }

  // Stable sort, strongest signal first.
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, MAX_DECISIONS).map((c) => ({
    symbol: c.symbol,
    action: c.action,
    positionSizePercent: SIZE_PCT,
    reason: '${s.id.replace(/_/g, '-')} ' + c.action.toLowerCase() + ' on ' + c.symbol,
  }));
}
`;

const SPECS: Spec[] = [
  {
    id: 'momentum',
    label: 'Momentum',
    blurb: 'Ride confirmed trends; sit out chop. Medium size.',
    persona:
      'Momentum trader. Enter LONG only on UP/STRONG_UP with positive 15m change; SHORT on DOWN/STRONG_DOWN with negative 15m. Skip high volatility (>5%). Prefer the strongest few names. Size ~12%. Reasons stay short and factual.',
    summary: 'ride confirmed trends; sit out chop.',
    maxDecisions: 3,
    sizePct: 12,
    extra: `const UP = new Set(['UP', 'STRONG_UP']);\nconst DOWN = new Set(['DOWN', 'STRONG_DOWN']);\n`,
    body: `    const ch15 = num(a.priceChange15m);
    const ch1h = num(a.priceChange1h);
    if (vol > 5.0) continue;
    if (UP.has(trend) && ch15 > 0.4) {
      scored.push({ score: ch15 + 0.25 * ch1h, symbol, action: 'LONG' });
    } else if (DOWN.has(trend) && ch15 < -0.4) {
      scored.push({ score: Math.abs(ch15) + 0.25 * Math.abs(ch1h), symbol, action: 'SHORT' });
    }`,
  },
  {
    id: 'mean_reversion',
    label: 'Mean reversion',
    blurb: 'Fade stretched moves back toward the mid-range.',
    persona:
      'Mean-reversion trader. Fade prices near recentHigh after a short pop (SHORT) and near recentLow after a short dump (LONG). Avoid extreme volatility. Size ~10%. Patience over activity — empty decisions when the range is mid.',
    summary: 'fade stretched moves back toward the mid.',
    maxDecisions: 3,
    sizePct: 10,
    body: `    const high = num(a.recentHigh) || price;
    const low = num(a.recentLow) || price;
    const ch5 = num(a.priceChange5m);
    if (price <= 0 || high <= low || vol > 6.0) continue;
    const pos = (price - low) / (high - low); // 0 = at the low, 1 = at the high
    if (pos >= 0.85 && ch5 > 0.3) {
      scored.push({ score: pos, symbol, action: 'SHORT' });
    } else if (pos <= 0.15 && ch5 < -0.3) {
      scored.push({ score: 1 - pos, symbol, action: 'LONG' });
    }`,
  },
  {
    id: 'conservative',
    label: 'Conservative',
    blurb: 'Only strong multi-timeframe alignment; small size.',
    persona:
      'Conservative trader. Require STRONG_UP or STRONG_DOWN plus aligned 15m/30m/1h changes. Cap size ~6%, max two names. Prefer holding cash when signals conflict. Flat is success.',
    summary: 'only strong multi-timeframe alignment; small size.',
    maxDecisions: 2,
    sizePct: 6,
    body: `    const ch15 = num(a.priceChange15m);
    const ch30 = num(a.priceChange30m);
    const ch1h = num(a.priceChange1h);
    if (vol > 3.5) continue;
    if (trend === 'STRONG_UP' && ch15 > 0.8 && ch30 > 0.5 && ch1h > 0.3) {
      scored.push({ score: ch1h, symbol, action: 'LONG' });
    } else if (trend === 'STRONG_DOWN' && ch15 < -0.8 && ch30 < -0.5 && ch1h < -0.3) {
      scored.push({ score: Math.abs(ch1h), symbol, action: 'SHORT' });
    }`,
  },
  {
    id: 'degen',
    label: 'Degen',
    blurb: 'Aggressive short-horizon entries; larger size.',
    persona:
      'Degen trader. Chase short-horizon 1m/5m pops and dumps. Size ~22%. Cut losers fast via server stops; brag only with closed PnL. Still respect the 3-decision cap.',
    summary: 'aggressive entries on short-horizon moves; larger size.',
    maxDecisions: 3,
    sizePct: 22,
    body: `    const ch1 = num(a.priceChange1m);
    const ch5 = num(a.priceChange5m);
    const score = Math.abs(ch5) * 2 + Math.abs(ch1);
    if (ch5 >= 0.35 || ((trend === 'UP' || trend === 'STRONG_UP') && ch1 > 0.15)) {
      scored.push({ score, symbol, action: 'LONG' });
    } else if (ch5 <= -0.35 || ((trend === 'DOWN' || trend === 'STRONG_DOWN') && ch1 < -0.15)) {
      scored.push({ score, symbol, action: 'SHORT' });
    }`,
  },
];

export const BUNDLED_STYLES: TradingStyle[] = SPECS.map((s) => ({
  id: s.id,
  label: s.label,
  blurb: s.blurb,
  persona: s.persona,
  decideTs: HEADER(s),
}));

export function styleIds(styles: TradingStyle[] = BUNDLED_STYLES): string[] {
  return styles.map((s) => s.id);
}

/**
 * Combine the backend catalog (GET /api/arena/styles) with the bundled styles.
 * A remote `decideTs` wins over the bundled one; a remote style without
 * `decideTs` (today's catalog only has decidePy) falls back to the bundled
 * source for that id, and is dropped if there is none. Remote label/blurb/persona
 * win when present. With no usable remote catalog the bundled list is returned.
 */
export function mergeCatalog(remote: unknown): TradingStyle[] {
  if (!Array.isArray(remote)) return BUNDLED_STYLES;
  const bundled = new Map(BUNDLED_STYLES.map((s) => [s.id, s]));
  const out: TradingStyle[] = [];
  const seen = new Set<string>();
  for (const r of remote) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || seen.has(o.id)) continue;
    const base = bundled.get(o.id);
    const decideTs = typeof o.decideTs === 'string' && o.decideTs.trim() ? o.decideTs : base?.decideTs;
    if (!decideTs) continue;
    seen.add(o.id);
    out.push({
      id: o.id,
      label: typeof o.label === 'string' ? o.label : base?.label ?? o.id,
      blurb: typeof o.blurb === 'string' ? o.blurb : base?.blurb ?? '',
      persona: typeof o.persona === 'string' && o.persona ? o.persona : base?.persona ?? '',
      decideTs,
    });
  }
  for (const b of BUNDLED_STYLES) if (!seen.has(b.id)) out.push(b);
  return out.length ? out : BUNDLED_STYLES;
}

export function personaMarkdown(agentName: string, persona: string): string {
  return (
    `# ${agentName} — Persona\n\n${persona.trim()}\n\n` +
    "This file is uploaded as your agent's `systemPrompt` on join and is the " +
    'human-readable record of how this bot is supposed to behave. Update it ' +
    'whenever your strategy changes.\n'
  );
}
