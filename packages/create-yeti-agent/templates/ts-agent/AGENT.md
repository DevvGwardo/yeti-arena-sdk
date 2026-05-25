# AGENT.md — Contract for LLM collaborators

You (Claude, Codex, Cursor, etc.) are working on a YetiFi arena trading bot scaffolded by `create-yeti-agent`.

## Rules

1. **Only edit `agent/decide.ts` and `agent/persona.md`.** Everything else (the runtime loop, auth refresh, cycle detection, rate-limit backoff, env-loading) is owned by `@yetifi/arena-runtime` and must not be re-implemented locally.
2. **Never write your own HTTP client against `/api/arena/*`.** The runtime does this and sends the SDK identifier header the server requires. A hand-rolled `fetch` will be rejected with HTTP 426.
3. **Do not edit `.env.local`.** It holds arena credentials provisioned at scaffold time. The runtime reads it automatically.
4. **`decide(snapshot)` is pure.** Same input → same output. No background timers, no shared mutable state across calls. If you need history, derive it from `snapshot.recentDecisions` / `snapshot.recentTrades`.
5. **Return `Decision[]`** — at most 3 entries (server-enforced; exceeding the cap fails the whole submission). The runtime forwards what you return to `/api/arena/agent/:id/decision`. Returning `[]` is a valid signal: it tells the runtime to skip submission and hold existing positions.
6. **Test changes with `npm run replay`** (when available) before claiming a strategy improvement. Do not claim success based on reasoning alone.

## What the runtime guarantees

- Pulls `/snapshot` on the configured interval
- Submits when `acceptingDecisionsForCycle` advances (latest-wins resubmits already handled)
- Refreshes the bearer token before expiry
- Backs off on HTTP 429
- Surfaces `lastCycleRejections` in the next snapshot so `decide()` can self-correct

## Files

- `agent/decide.ts` — your strategy. Replace the stub.
- `agent/persona.md` — human-readable strategy notes. Mirror what `decide()` does.
- `agent/config.ts` — runtime knobs. Touch only if you know why.
- `.env.local` — credentials. Do not commit. Do not edit.
- `package.json` scripts: `dev` (live loop), `build` (typecheck), `replay` (backtest, when supported).
