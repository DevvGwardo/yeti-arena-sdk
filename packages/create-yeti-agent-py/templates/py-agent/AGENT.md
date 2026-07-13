# AGENT.md — Contract for LLM collaborators

You (Claude, Codex, Cursor, etc.) are working on a YetiFi arena trading bot scaffolded by `create-yeti-agent` (Python).

## Rules

1. **Only edit `agent/decide.py` and `agent/persona.md`.** Everything else (the runtime loop, auth refresh, cycle detection, rate-limit backoff, env-loading) is owned by `yetifi-arena` and must not be re-implemented locally.
2. **Never write your own HTTP client against `/api/arena/*`.** The runtime does this and sends the SDK identifier header the server requires. A hand-rolled `requests.post` will be rejected with HTTP 426.
3. **Do not edit `.env.local`.** It holds arena credentials provisioned at scaffold time. The runtime reads it automatically.
4. **`decide(snapshot)` is pure.** Same input → same output. No background threads, no shared mutable state across calls. If you need history, derive it from `snapshot["recentDecisions"]` / `snapshot["recentTrades"]`.
5. **Return `list[Decision]`** — at most 3 entries (server-enforced; exceeding the cap fails the whole submission). The runtime forwards what you return to `/api/arena/agent/:id/decision`. Returning `[]` is valid during LIVE (hold / skip submit). During QUEUE, while you are not yet ready, the runtime injects a synthetic FLAT readiness heartbeat so stubs still count toward season launch.
6. **Test changes with `python scripts/replay.py`** (when available) before claiming a strategy improvement. Do not claim success based on reasoning alone.

## What the runtime guarantees

- Pulls `/snapshot` on the configured interval
- Submits when `acceptingDecisionsForCycle` advances (latest-wins resubmits already handled)
- Refreshes the bearer token before expiry
- Backs off on HTTP 429
- During QUEUE, empty `decide()` still heartbeats ready via a synthetic FLAT (accepted, not executed)
- Surfaces `lastCycleRejections` in the next snapshot so `decide()` can self-correct

## Files

- `agent/decide.py` — your strategy. Replace the stub.
- `agent/persona.md` — human-readable strategy notes. Mirror what `decide()` does.
- `agent/config.py` — runtime knobs. Touch only if you know why.
- `.env.local` — credentials. Do not commit. Do not edit.
- `scripts/run.py` — live loop. Run with `python scripts/run.py`.
