# yeti-arena-sdk — Goal

Ship `npx create-yeti-agent <name>` (and `uvx create-yeti-agent <name>`) as the only supported way to onboard a new external trading agent in the YetiFi arena.

## Status

| | Status |
|---|---|
| TS runtime `@yetifi/arena-runtime` | ✅ built, tested, smoke-verified |
| TS scaffolder `create-yeti-agent` (npx) | ✅ built, smoke-verified end-to-end |
| Python runtime `yetifi-arena` | ✅ built, 10/10 unit tests, smoke-verified |
| Python scaffolder `create-yeti-agent` (uvx) | ✅ built, smoke-verified end-to-end |
| Backend `/api/arena/join` SDK gate | ✅ shipped behind `YETI_ENFORCE_SDK` env flag, 14 tests |
| Backend `/api/arena/manifest` schemas | ✅ ships `sdk` + `schemas` blocks (Decision/DecisionSubmission/Rejection JSON Schema) |
| `AGENT_COLLABORATION.md` rewrite | ✅ SDK-first, raw HTTP demoted to "Internals" appendix |
| Snapshot-replay backend endpoint | ⏸ deferred — needs new persistence (see task #6) |
| Wipe + force-push to `DevvGwardo/hermes-arena-starter` | ⏸ launch day only, requires explicit go-ahead |
| `npm publish` + `uv publish` | ⏸ launch day |
| Flip `YETI_ENFORCE_SDK=true` in Railway prod | ⏸ launch day |

## Definition of done

- `npx create-yeti-agent my-bot` scaffolds a working project in <60s — ✅ verified
- Scaffold provisions arena credentials in-band (one command) — ✅ verified
- Authors only ever touch `agent/decide.{ts,py}` and `agent/persona.md` — ✅ enforced via `AGENT.md` dropped in every scaffold
- The runtime owns: pull loop, JWT refresh, cycle-advance detection, rate-limit backoff, latest-wins resubmission, `lastCycleRejections` surfacing — ✅ TS + Python
- Types are codegen-friendly from `/api/arena/manifest` — ✅ manifest now publishes Decision/DecisionSubmission/Rejection schemas; codegen step itself is a future runtime feature
- Backend returns **HTTP 426 Upgrade Required** to non-SDK callers when enforcement is on — ✅ verified live
- Python parity ships in the same monorepo — ✅
- `npm run replay` lets authors backtest `decide()` against historical snapshots — ❌ deferred (needs backend snapshot store)
- `hermes-arena-starter` overwritten + docs rewritten — ✅ docs rewritten, repo wipe pending launch
- `YETI_ENFORCE_SDK=true` in prod — ⏸ launch day flip

## Non-goals

- Backwards compatibility for direct-HTTP joiners (hard cutover, by design)
- Multi-agent-per-user — backend still enforces one agent per IP
- Strategy templates beyond a stub `decide()` returning `[]`
- Any change to the cycle clock, pricing feeds, or trade processor

## Architecture (as built)

```
~/yeti-arena-sdk/                          (new repo, will overwrite hermes-arena-starter)
├── GOAL.md                                this file
├── README.md
├── package.json                           npm workspace root
└── packages/
    ├── arena-runtime-ts/                  → publish as @yetifi/arena-runtime
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts                   defineAgent, runFromCwd, runReplay
    │       ├── client.ts                  HTTP client, sends x-yeti-sdk header
    │       ├── loop.ts                    cycle-advance loop, latest-wins resubmit
    │       ├── auth.ts                    JWT refresh w/ backoff
    │       └── types.ts                   Snapshot/Decision/AgentConfig
    ├── create-yeti-agent/                 → publish as create-yeti-agent (npx)
    │   ├── package.json
    │   ├── src/cli.ts
    │   └── templates/ts-agent/            files dropped into new projects
    │       ├── agent/{decide,config}.ts
    │       ├── agent/persona.md
    │       ├── AGENT.md                   LLM guardrails
    │       ├── scripts/run.ts
    │       ├── package.json, tsconfig.json, _gitignore
    ├── arena-runtime-py/                  → publish as yetifi-arena (PyPI)
    │   ├── pyproject.toml
    │   ├── src/yetifi_arena/{__init__,types,client,auth,loop,agent}.py
    │   └── tests/test_smoke.py            10 tests
    └── create-yeti-agent-py/              → publish as create-yeti-agent (uvx)
        ├── pyproject.toml                 stdlib-only deps (urllib)
        ├── src/create_yeti_agent_py/cli.py
        └── templates/py-agent/
            ├── agent/{decide,config,persona,__init__}.py / .md
            ├── AGENT.md
            ├── scripts/run.py
            ├── pyproject.toml, _gitignore
```

## What changed in the backend (yetifi_trader_backend)

- `state/sdkGate.ts` — `isValidSdkHeader()` + `YETI_ENFORCE_SDK` flag + `SDK_HEADER_NAME`
- `state/arenaAgentState.ts` — new `ARENA_REJECTION_REASONS` tuple, exported
- `index.ts:473` — `/api/arena/join` rejects non-SDK callers with HTTP 426 + upgrade body
- `index.ts:1030` — `/api/arena/manifest` ships new `sdk` and `schemas` blocks
- `scripts/arena-join.ts` — sends `x-yeti-sdk` header on the internal CLI
- `tests/services/sdkGate.test.ts` — 14 unit tests
- `tests/services/arenaManifest.test.ts` — 2 new tests pinning `ARENA_REJECTION_REASONS`
- `AGENT_COLLABORATION.md` — rewritten SDK-first

## Launch checklist

1. Pre-flight:
   - `cd ~/yeti-arena-sdk && npm install && npm test`
   - `cd packages/arena-runtime-py && .venv/bin/pytest -q`
   - `cd packages/create-yeti-agent-py && uv sync && python -c "from create_yeti_agent_py.cli import main; main(['--help'])"`
2. Publish:
   - `npm publish --access public` in `packages/arena-runtime-ts` and `packages/create-yeti-agent`
   - `uv publish` in `packages/arena-runtime-py` and `packages/create-yeti-agent-py`
3. Repo wipe (destructive — needs explicit go-ahead):
   - `cd ~/yeti-arena-sdk && git init && git add . && git commit -m "Switch to SDK-cutover layout"`
   - `git remote add origin git@github.com:DevvGwardo/hermes-arena-starter.git`
   - `git push -u origin main --force` (after confirming the GitHub URL is the right target)
4. Backend prod flip:
   - Set `YETI_ENFORCE_SDK=true` in Railway env
   - No code redeploy needed — gate is env-toggled
5. Watch:
   - Tail Railway logs for `/api/arena/join` 426 responses (they should drop to ~zero within 24h as agents migrate)
   - Check `/api/arena/manifest` returns `sdk.enforced: true`
