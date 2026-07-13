# AGENTS.md — Contract for coding agents

> Follows the [agents.md](https://agents.md) convention. If you are a coding
> agent (Claude Code, Cursor, Codex, Aider, etc.) operating in this repo,
> read this first.

## What this project is

A YetiFi trading-arena bot scaffolded by `create-yeti-agent`. The agent polls
the arena every `pollIntervalMs`, runs a 3-pass educated-decision pipeline
through the wired LLM, and submits validated trades via `yetifi-arena-runtime`.

**LLM wired by the scaffolder:** {{LLM_DESCRIPTION}}

## Decision pipeline (per cycle)

1. **`getRules()`** fetches `/api/arena/manifest` once at startup, cached 5 min. Provides the live server-enforced ceiling (`maxDecisionsPerCycle`, `maxPositionSizePercent`, `drawdownWarningPercent`, `drawdownSuspendedPercent`, schema, supported symbols) so the LLM and validator always agree with the API.
2. **`computeGuardrails(snapshot, rules)`** derives concrete per-cycle numbers — cash available, exposure headroom, distance-to-drawdown-suspend, recent-rejection histogram, suggested max new position. The LLM sees actionable values, never abstract rules.
3. **Pass A (Analysis)** — LLM call: regime + opportunities + risks. No decisions. Output is reused as Pass B context so the model commits to one view.
4. **Pass B (Decide)** — LLM call: ≤ `maxDecisionsPerCycle` JSON decisions, each citing a rule or guardrail. Symbols omitted hold their existing position.
5. **Pass C (Validate)** — Client-side filter against the manifest schema. Anything that would be rejected server-side (bad symbol, oversize, missing reason, etc.) gets dropped before the runtime ever sees it. The runtime is guaranteed to submit a valid set.
6. **SUSPENDED short-circuit** — If guardrails report status=SUSPENDED, both LLM calls are skipped and `decide()` returns `[]` (the server will reject anything else anyway).

## Files you may edit

| Path | Purpose |
| --- | --- |
| `agent/persona.md` | System prompt for both LLM passes. **This is where the strategy lives — edit here first.** |
| `agent/decide.ts` | 3-pass pipeline plumbing. Touch only if you need different signals or a different number of passes. |
| `agent/llm.ts` | Provider call (Hermes / Anthropic / OpenAI / Gemini / Ollama / stub). Swap to retarget. |
| `agent/guardrails.ts` | Risk envelope computation. Edit if you want different sizing tiers or new gates. |
| `agent/rules.ts` | Manifest fetcher + cache. Rarely needs editing. |

## Files you must NOT edit

| Path | Why |
| --- | --- |
| `.env.local` | Arena credentials provisioned at scaffold time. Runtime reads it automatically. |
| `package.json` deps | Runtime/scaffolder owns the dep tree. |
| `scripts/run.ts` | Boot harness — replacing it bypasses .env.local loading, bearer refresh, 401 backoff, JOIN_WINDOW handling, etc. |

## Rules

1. **`decide(snapshot)` is pure-ish.** Same input → same output for the validation/parsing layer. The LLM is allowed to vary (temperature), but the plumbing around it is deterministic. No background timers, no `setInterval`.
2. **Never bypass `Pass C` validation.** The server's rejection-of-the-whole-batch behavior is unforgiving — one bad decision drops the whole submission. Validation lives in `decide.ts:validateAgainstManifest`. Keep it.
3. **Don't hand-roll HTTP against `/api/arena/*`.** The runtime sends the SDK-identifier header the server requires. Hand-rolled fetch → HTTP 426.
4. **Returning `[]` is valid and often optimal.** During LIVE it tells the runtime to skip submission and hold existing positions. During QUEUE, while you are not yet ready, the runtime still submits a synthetic FLAT heartbeat so you count toward season launch.
5. **`getRules()` is the source of truth for limits.** Never hardcode `3` for max decisions or `100` for max position — read from the manifest snapshot. The server can change these without warning.

## What the runtime guarantees

- Polls `/snapshot` on `pollIntervalMs` (default 15s).
- Submits when `acceptingDecisionsForCycle` advances (latest-wins).
- Refreshes the bearer token before expiry.
- 5s → 30s → 5min exponential backoff on 401 (since 0.1.3).
- During JOIN_WINDOW, sleeps until `activatesAt` instead of tight-looping.
- During QUEUE, if you are not yet ready and `decide()` returns `[]`, injects a synthetic FLAT readiness heartbeat (accepted, not executed) so stubs still count toward launch.
- Surfaces `snapshot.lastCycleRejections` — guardrails.ts already digests these for the LLM.

## Reasoning trace

Every cycle writes the LLM inputs/outputs of both passes to `.decide-trace.log` in the project root (set `DECIDE_TRACE=0` to disable, or `DECIDE_TRACE_FILE=path` to redirect). Inspect it when a strategy change isn't producing the expected behavior — the trace shows exactly what the model said and which decisions were dropped at validation.

## Iteration playbook

When the user asks you to improve the strategy:

1. **Read `agent/persona.md`** — the strategy framework. 80% of behavior changes happen here.
2. **Read recent `.decide-trace.log` entries** — see what the LLM actually said the last few cycles. Is it identifying the regime correctly? Are its decisions getting dropped at validation? Is it ignoring the guardrails?
3. **Iterate on `persona.md` first** — cheapest change, biggest leverage. Make the regime/sizing/risk framework tighter or add domain-specific rules.
4. **Touch `decide.ts` only if the LLM needs different signals** — e.g. you want it to see longer trade history, news, or a custom indicator. The prompt builders (`buildMarketBlock`, `buildPortfolioBlock`) are where to add fields.
5. **Touch `guardrails.ts` if sizing logic needs to change** — e.g. you want WARNING to cut sizing to 0.25× instead of 0.5×, or you want a new "near-rate-limit" gate.
6. **Touch `llm.ts` to swap providers, change temperature, or tweak max_tokens.** Don't touch it for strategy reasons.
7. **`npm run build`** — typecheck after every edit. Errors here are cheaper to fix than runtime errors.
8. **After deploying a change, watch `.decide-trace.log` for at least 3 cycles** before claiming improvement. Single-cycle outcomes are noise.

## Provider-specific notes

- **Hermes / Ollama:** Local, no cost per call. Multi-pass is essentially free. Watch CPU/RAM if you crank `pollIntervalMs` low.
- **Anthropic / OpenAI / Gemini:** Cloud, per-token cost. **Multi-pass doubles cost per cycle.** Default poll cadence (15s) ≈ 240 cycle-calls/hr × 2 passes = 480 LLM calls/hr. Bump `pollIntervalMs` to 60_000 for cost control, or set `DECIDE_SKIP_ANALYSIS=1` (future) to drop Pass A and run decide-only.
- **Stub:** No LLM. `decide()` returns `[]` every cycle. Replace `agent/llm.ts` with a real implementation or re-scaffold after setting an API key.
