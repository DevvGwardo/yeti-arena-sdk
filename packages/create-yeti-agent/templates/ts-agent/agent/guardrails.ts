// Guardrails — turn the abstract rules + live agent state into concrete,
// per-cycle numbers the LLM cannot misinterpret. "You are at 14.2%
// drawdown; 20% triggers a 24h suspension" is actionable. "Watch your
// drawdown" is not.

import type { Snapshot } from 'yetifi-arena-runtime';
import type { ArenaRules } from './rules';

export interface Guardrails {
  // Cash you can still allocate this cycle, as percent of portfolioValue.
  // 0 means fully invested; 100 means all cash. The position-sizing in
  // any new LONG/SHORT must fit inside this number.
  cashAvailablePercent: number;

  // Sum of |positionSizePercent| across currently open positions.
  // maxTotalExposurePercent minus this is the headroom you have left.
  currentExposurePercent: number;
  exposureHeadroomPercent: number;

  // Drawdown picture. distanceToSuspendedPct < 5 means one bad cycle
  // could trip the 24h SUSPENDED circuit-breaker; the LLM should be
  // de-risking, not adding leverage.
  currentDrawdownPercent: number;
  distanceToWarningPercent: number;
  distanceToSuspendedPercent: number;

  // The agent's last-cycle rejections grouped by reason. The LLM should
  // adjust strategy based on these — if it keeps getting
  // insufficient_cash, the position sizes are too greedy for current
  // cash; if max_positions_reached, it should FLAT something before
  // opening a new one.
  recentRejectionsByReason: Record<string, number>;
  totalRecentRejections: number;

  // Position concentration check. Number of distinct coins held — if it
  // exceeds maxDecisionsPerCycle, the LLM cannot rotate the whole book in
  // a single cycle, so changes must be staged across cycles.
  openPositionCount: number;
  canOpenNewPosition: boolean;

  // Status-derived guardrail. ACTIVE = normal sizing OK; WARNING = halve
  // sizes; SUSPENDED = every decision is a no-op anyway, return [].
  status: 'ACTIVE' | 'WARNING' | 'SUSPENDED';
  suggestedMaxNewPositionPercent: number;
}

// Sum of open-position percent-of-portfolio. Each open trade's
// (entryPrice × quantity) / portfolioValue is its allocated share.
function computeOpenExposurePercent(snapshot: Snapshot): number {
  const pv = snapshot.portfolio.portfolioValue;
  if (pv <= 0) return 0;
  let used = 0;
  for (const t of Object.values(snapshot.portfolio.openTrades)) {
    if (!t) continue;
    used += Math.abs((t.entryPrice * t.quantity) / pv) * 100;
  }
  return Math.min(100, used);
}

// Suggest a sizing ceiling that respects:
//   1. exposure headroom (can't exceed maxTotalExposurePercent)
//   2. drawdown status (WARNING → halve, SUSPENDED → zero)
//   3. open-positions budget (need room to deploy without forcing FLAT)
function suggestMaxNew(
  rules: ArenaRules,
  status: 'ACTIVE' | 'WARNING' | 'SUSPENDED',
  exposureHeadroomPercent: number,
  distanceToSuspendedPercent: number,
): number {
  if (status === 'SUSPENDED') return 0;
  let ceiling = Math.min(rules.maxPositionSizePercent, exposureHeadroomPercent);
  if (status === 'WARNING') ceiling = ceiling * 0.5;
  // Drawdown proximity tightens the ceiling further — closer to the
  // 24h-suspend trip wire, smaller the swing should be.
  if (distanceToSuspendedPercent < 3) ceiling = Math.min(ceiling, 10);
  else if (distanceToSuspendedPercent < 5) ceiling = Math.min(ceiling, 20);
  else if (distanceToSuspendedPercent < 8) ceiling = Math.min(ceiling, 35);
  return Math.max(0, Math.floor(ceiling));
}

export function computeGuardrails(snapshot: Snapshot, rules: ArenaRules): Guardrails {
  const currentExposurePercent = computeOpenExposurePercent(snapshot);
  const exposureHeadroomPercent = Math.max(0, rules.maxTotalExposurePercent - currentExposurePercent);
  const cashAvailablePercent = snapshot.portfolio.portfolioValue > 0
    ? Math.max(0, (snapshot.portfolio.cash / snapshot.portfolio.portfolioValue) * 100)
    : 0;

  const dd = snapshot.portfolio.currentDrawdownPercent;
  const distanceToWarningPercent = Math.max(0, rules.drawdownWarningPercent - dd);
  const distanceToSuspendedPercent = Math.max(0, rules.drawdownSuspendedPercent - dd);

  const rejections = snapshot.lastCycleRejections || [];
  const recentRejectionsByReason: Record<string, number> = {};
  for (const r of rejections) {
    recentRejectionsByReason[r.reason] = (recentRejectionsByReason[r.reason] || 0) + 1;
  }

  const openPositionCount = Object.keys(snapshot.portfolio.openTrades).length;
  const canOpenNewPosition =
    snapshot.status !== 'SUSPENDED'
    && exposureHeadroomPercent > 0
    && cashAvailablePercent > 0;

  const suggestedMaxNewPositionPercent = suggestMaxNew(
    rules,
    snapshot.status,
    Math.min(exposureHeadroomPercent, cashAvailablePercent),
    distanceToSuspendedPercent,
  );

  return {
    cashAvailablePercent: Number(cashAvailablePercent.toFixed(2)),
    currentExposurePercent: Number(currentExposurePercent.toFixed(2)),
    exposureHeadroomPercent: Number(exposureHeadroomPercent.toFixed(2)),
    currentDrawdownPercent: Number(dd.toFixed(2)),
    distanceToWarningPercent: Number(distanceToWarningPercent.toFixed(2)),
    distanceToSuspendedPercent: Number(distanceToSuspendedPercent.toFixed(2)),
    recentRejectionsByReason,
    totalRecentRejections: rejections.length,
    openPositionCount,
    canOpenNewPosition,
    status: snapshot.status,
    suggestedMaxNewPositionPercent,
  };
}

// Render guardrails as the "Constraints" block the LLM sees. Plain text
// over JSON — models follow imperative text more reliably than they
// follow numbers in nested objects.
export function formatGuardrailsBlock(g: Guardrails, rules: ArenaRules): string {
  const lines: string[] = [];
  lines.push(`Status: ${g.status}` + (g.status === 'SUSPENDED' ? ' — submit only FLAT decisions; new positions are rejected.' : ''));
  lines.push(`Cash available: ${g.cashAvailablePercent}% of portfolio.`);
  lines.push(`Open exposure: ${g.currentExposurePercent}% — headroom ${g.exposureHeadroomPercent}% (cap ${rules.maxTotalExposurePercent}%).`);
  lines.push(`Drawdown: ${g.currentDrawdownPercent}%. Warning at ${rules.drawdownWarningPercent}% (in ${g.distanceToWarningPercent}%). Suspended at ${rules.drawdownSuspendedPercent}% (in ${g.distanceToSuspendedPercent}%).`);
  lines.push(`Open positions: ${g.openPositionCount}.`);
  lines.push(`Max NEW position size you should consider this cycle: ${g.suggestedMaxNewPositionPercent}% of portfolio.`);
  lines.push(`Hard ceilings: per-decision ${rules.maxPositionSizePercent}%, total exposure ${rules.maxTotalExposurePercent}%, decisions per cycle ${rules.maxDecisionsPerCycle}.`);
  if (g.totalRecentRejections > 0) {
    const detail = Object.entries(g.recentRejectionsByReason).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`Last cycle had ${g.totalRecentRejections} rejection(s) (${detail}). Adjust accordingly.`);
  }
  return lines.join('\n');
}

export function formatRulesBlock(rules: ArenaRules): string {
  return [
    `Actions: ${rules.actions.join(', ')}. FLAT closes any existing position for that symbol.`,
    `Symbols you omit hold their existing position — only include a symbol when you want to change it.`,
    `Stop-loss and take-profit are server-side; do not include them in your decision.`,
    `Max ${rules.maxDecisionsPerCycle} decisions per submission. Each decision: symbol, action, positionSizePercent (0-${rules.maxPositionSizePercent}), reason (≤${rules.reasonMaxChars} chars).`,
    `Total exposure across open positions must stay ≤ ${rules.maxTotalExposurePercent}%.`,
    `Drawdown circuit-breaker: WARNING at ${rules.drawdownWarningPercent}%, SUSPENDED for 24h at ${rules.drawdownSuspendedPercent}%.`,
    `Cycle is ${rules.cycleIntervalSec}s; rate limit ${rules.requestsPerMinute} requests/min.`,
  ].join('\n');
}
