// 3-pass educated-decision pipeline. Designed so the LLM sees the same
// rules + risk envelope the server-side validators do, reasons about
// regime first, then commits to decisions, and never submits anything
// that would be rejected at the API boundary.
//
// Pass A — Analysis : market regime, opportunities, risks. No decisions.
// Pass B — Decide   : ≤ N decisions citing rules + guardrails.
// Pass C — Validate : client-side filter against manifest schema.
//
// If you only edit one file, edit agent/persona.md — the persona is the
// system prompt for BOTH passes. decide.ts handles the plumbing; the
// strategy lives in persona.md.

import fs from 'fs';
import path from 'path';
import type { Snapshot, Decision, TradeAction } from 'yetifi-arena-runtime';
import { callLlm } from './llm';
import { getRules, type ManifestSnapshot } from './rules';
import { computeGuardrails, formatGuardrailsBlock, formatRulesBlock } from './guardrails';

const VALID_ACTIONS = new Set<TradeAction>(['LONG', 'SHORT', 'FLAT']);
const PERSONA_FILE = path.join(__dirname, 'persona.md');
const TRACE_FILE = process.env.DECIDE_TRACE_FILE || path.join(process.cwd(), '.decide-trace.log');
const ENABLE_TRACE = process.env.DECIDE_TRACE !== '0';

function loadPersona(): string {
  try {
    return fs.readFileSync(PERSONA_FILE, 'utf8').trim();
  } catch {
    return 'You are a disciplined crypto trader optimizing for risk-adjusted PnL.';
  }
}

function trace(label: string, payload: string): void {
  if (!ENABLE_TRACE) return;
  try {
    const stamp = new Date().toISOString();
    fs.appendFileSync(TRACE_FILE, `\n=== ${stamp} — ${label} ===\n${payload}\n`);
  } catch {
    // Trace is observability, never block a cycle on a write failure.
  }
}

// ---------------------------------------------------------------------------
// Market block — compact textual digest of every coin the snapshot reports.
// ---------------------------------------------------------------------------
function buildMarketBlock(snapshot: Snapshot): string {
  const lines: string[] = ['Market:'];
  for (const [sym, c] of Object.entries(snapshot.coins)) {
    const a = (c as { analysis?: { rsi1h?: number; rsi4h?: number; rsi1d?: number; trend?: string; volatilityPct?: number; priceChange1h?: number; priceChange24h?: number } }).analysis;
    const tail = a
      ? ` | rsi1h=${fmt(a.rsi1h)} rsi4h=${fmt(a.rsi4h)} rsi1d=${fmt(a.rsi1d)} trend=${a.trend ?? '?'} vol=${fmt(a.volatilityPct)}% Δ1h=${fmt(a.priceChange1h)}% Δ24h=${fmt(a.priceChange24h)}%`
      : '';
    lines.push(`  ${sym}: $${c.price.toFixed(4)}${tail}`);
  }
  return lines.join('\n');
}

function fmt(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '?';
}

// ---------------------------------------------------------------------------
// Portfolio block — what the agent currently holds and how it has been doing.
// ---------------------------------------------------------------------------
function buildPortfolioBlock(snapshot: Snapshot): string {
  const lines: string[] = [];
  lines.push(`Portfolio: $${snapshot.portfolio.portfolioValue.toFixed(2)} (cash $${snapshot.portfolio.cash.toFixed(2)}, unrealized PnL $${snapshot.portfolio.unrealizedPnl.toFixed(2)}).`);
  const open = Object.values(snapshot.portfolio.openTrades);
  if (open.length) {
    lines.push('Open positions:');
    for (const t of open) {
      lines.push(`  ${t.symbol} ${t.action} entry=$${t.entryPrice.toFixed(4)} qty=${t.quantity}`);
    }
  } else {
    lines.push('Open positions: none.');
  }
  if (snapshot.recentTrades && snapshot.recentTrades.length) {
    const recent = snapshot.recentTrades.slice(0, 5);
    lines.push(`Last ${recent.length} closed trade(s):`);
    for (const tr of recent) {
      const t = tr as { symbol?: string; action?: string; pnl?: number; pnlPercent?: number };
      const pnl = typeof t.pnl === 'number' ? `$${t.pnl.toFixed(2)}` : '?';
      const pct = typeof t.pnlPercent === 'number' ? `${t.pnlPercent.toFixed(2)}%` : '?';
      lines.push(`  ${t.symbol ?? '?'} ${t.action ?? '?'} → ${pnl} (${pct})`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pass A — Analysis. No decisions, only observation. Output is reused as
// the user-message context in Pass B so the model commits to one regime
// view rather than re-deriving it inside the decide step.
// ---------------------------------------------------------------------------
async function passAnalyze(
  system: string,
  rulesBlock: string,
  guardBlock: string,
  marketBlock: string,
  portfolioBlock: string,
): Promise<string | null> {
  const user = [
    'PASS A — ANALYSIS ONLY. Do NOT output decisions yet.',
    '',
    'Arena rules (server-enforced):',
    rulesBlock,
    '',
    'Your constraints right now:',
    guardBlock,
    '',
    portfolioBlock,
    '',
    marketBlock,
    '',
    'Produce a short analysis covering:',
    '  1. Market regime (risk-on / risk-off / mixed / choppy) — one sentence + the strongest evidence.',
    '  2. Top 1-3 opportunities the rules + constraints actually allow.',
    '  3. Top 1-2 risks that should reduce sizing or trigger FLAT this cycle.',
    'Be terse. No JSON. Bullet points or short paragraphs.',
  ].join('\n');
  return safeLlm('analysis', system, user);
}

// ---------------------------------------------------------------------------
// Pass B — Decide. Reuses Pass A as upstream context and forces JSON.
// ---------------------------------------------------------------------------
async function passDecide(
  system: string,
  rulesBlock: string,
  guardBlock: string,
  marketBlock: string,
  portfolioBlock: string,
  analysis: string,
  cycle: number,
  maxDecisions: number,
  symbolEnum: string[],
): Promise<string | null> {
  const user = [
    `PASS B — DECIDE. Cycle ${cycle}. Submit AT MOST ${maxDecisions} decisions. Omit a symbol to hold its current position.`,
    '',
    'Arena rules (server-enforced):',
    rulesBlock,
    '',
    'Your constraints right now:',
    guardBlock,
    '',
    portfolioBlock,
    '',
    marketBlock,
    '',
    'Your analysis from Pass A (commit to this view, do not re-derive):',
    analysis || '(no analysis provided)',
    '',
    `Respond with JSON only, no prose, schema:`,
    `{"decisions":[{"symbol":"<one of ${symbolEnum.join('|')}>","action":"LONG|SHORT|FLAT","positionSizePercent":0-100,"reason":"≤280 chars, cite a rule or guardrail you respected"}]}`,
    '',
    'Validation hints:',
    '  - Skip decisions where positionSizePercent would breach exposureHeadroomPercent.',
    '  - Use FLAT to close positions that no longer fit your regime view.',
    '  - Returning {"decisions":[]} is valid when no setup beats the risk envelope.',
  ].join('\n');
  return safeLlm('decide', system, user);
}

async function safeLlm(label: string, system: string, user: string): Promise<string | null> {
  try {
    const raw = await callLlm(system, user);
    trace(label, raw ?? '(null)');
    return raw;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    trace(`${label}-error`, msg);
    console.warn(`[decide] ${label} llm call failed: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pass C — Client-side validation. Filters before the runtime submits so
// rejection-of-the-whole-batch is impossible. Every rule the server
// validates is mirrored here.
// ---------------------------------------------------------------------------
function extractJson(raw: string): unknown | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

interface ValidationResult {
  accepted: Decision[];
  dropped: Array<{ raw: unknown; reason: string }>;
}

function validateAgainstManifest(raw: unknown, manifest: ManifestSnapshot): ValidationResult {
  const wrapped = raw as { decisions?: unknown };
  const list = Array.isArray(wrapped?.decisions) ? wrapped.decisions : Array.isArray(raw) ? raw : [];
  const accepted: Decision[] = [];
  const dropped: ValidationResult['dropped'] = [];

  const { schema, rules } = manifest;
  const symbolSet = new Set(schema.symbolEnum.map((s) => s.toUpperCase()));
  const actionSet = new Set(schema.actionEnum);

  for (const item of list) {
    if (!item || typeof item !== 'object') {
      dropped.push({ raw: item, reason: 'not an object' });
      continue;
    }
    const d = item as Partial<Decision>;
    if (typeof d.symbol !== 'string') {
      dropped.push({ raw: item, reason: 'symbol missing or not a string' });
      continue;
    }
    const sym = d.symbol.toUpperCase();
    if (!symbolSet.has(sym)) {
      dropped.push({ raw: item, reason: `symbol "${d.symbol}" not in supported set` });
      continue;
    }
    if (typeof d.action !== 'string' || !actionSet.has(d.action) || !VALID_ACTIONS.has(d.action as TradeAction)) {
      dropped.push({ raw: item, reason: `action "${d.action}" not in ${schema.actionEnum.join('|')}` });
      continue;
    }
    if (typeof d.positionSizePercent !== 'number' || !Number.isFinite(d.positionSizePercent)) {
      dropped.push({ raw: item, reason: 'positionSizePercent missing or not finite' });
      continue;
    }
    if (d.positionSizePercent < schema.positionSizeMin || d.positionSizePercent > schema.positionSizeMax) {
      dropped.push({ raw: item, reason: `positionSizePercent ${d.positionSizePercent} outside [${schema.positionSizeMin}, ${schema.positionSizeMax}]` });
      continue;
    }
    const reasonRaw = typeof d.reason === 'string' ? d.reason.trim() : '';
    if (!reasonRaw) {
      dropped.push({ raw: item, reason: 'reason missing or empty' });
      continue;
    }
    const reason = reasonRaw.length > schema.reasonMaxLength ? reasonRaw.slice(0, schema.reasonMaxLength) : reasonRaw;
    accepted.push({
      symbol: sym,
      action: d.action as TradeAction,
      positionSizePercent: d.positionSizePercent,
      reason,
    });
    if (accepted.length >= rules.maxDecisionsPerCycle) break;
  }

  return { accepted, dropped };
}

// ---------------------------------------------------------------------------
// Entry point. Returns Decision[] guaranteed to satisfy every server rule
// we know about. Returns [] on any failure so the agent holds positions
// rather than crashing the loop.
// ---------------------------------------------------------------------------
export default async function decide(snapshot: Snapshot): Promise<Decision[]> {
  let manifest: ManifestSnapshot;
  try {
    manifest = await getRules();
  } catch (err) {
    console.warn('[decide] rules unavailable, holding positions:', err instanceof Error ? err.message : err);
    return [];
  }

  const system = loadPersona();
  const guard = computeGuardrails(snapshot, manifest.rules);

  // SUSPENDED short-circuit — the server will reject any non-FLAT, so
  // there is nothing useful to spend an LLM call on. Holding positions
  // (which is what the server's gate does for us anyway) is correct.
  if (guard.status === 'SUSPENDED') {
    trace('suspended-noop', JSON.stringify(guard));
    return [];
  }

  const rulesBlock = formatRulesBlock(manifest.rules);
  const guardBlock = formatGuardrailsBlock(guard, manifest.rules);
  const marketBlock = buildMarketBlock(snapshot);
  const portfolioBlock = buildPortfolioBlock(snapshot);

  const analysis = await passAnalyze(system, rulesBlock, guardBlock, marketBlock, portfolioBlock);

  const decideRaw = await passDecide(
    system,
    rulesBlock,
    guardBlock,
    marketBlock,
    portfolioBlock,
    analysis || '',
    snapshot.server.acceptingDecisionsForCycle,
    manifest.rules.maxDecisionsPerCycle,
    manifest.schema.symbolEnum,
  );
  if (!decideRaw) return [];

  const parsed = extractJson(decideRaw);
  if (!parsed) {
    console.warn('[decide] pass B did not return valid JSON — holding positions');
    trace('parse-fail', decideRaw);
    return [];
  }

  const { accepted, dropped } = validateAgainstManifest(parsed, manifest);
  if (dropped.length) {
    trace('validation-drop', JSON.stringify(dropped, null, 2));
    for (const d of dropped) {
      console.warn(`[decide] dropped invalid decision: ${d.reason}`);
    }
  }
  trace('accepted', JSON.stringify(accepted, null, 2));
  return accepted;
}
