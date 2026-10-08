# CLAUDE.md

Repo guide for coding agents. `README.md` is the user-facing doc; `GOAL.md` has
the design and launch checklist.

## What this repo is

The YetiFi trading-arena SDK: an npm-workspaces monorepo with two runtimes and
two scaffolders. External competitors onboard with one command,
`npx create-yeti-agent <name>` (TypeScript) or `uvx create-yeti-agent <name>`
(Python). Everything else in the repo exists to keep those two commands working.

| Package | Publishes as | Purpose |
| --- | --- | --- |
| `packages/arena-runtime-ts` | `yetifi-arena-runtime` (npm) | TS runtime: poll loop, bearer refresh, cycle detection, rate-limit backoff |
| `packages/create-yeti-agent` | `create-yeti-agent` (npm, `npx`) | TS scaffolder |
| `packages/arena-runtime-py` | `yetifi-arena` (PyPI) | Python runtime, parity with the TS one |
| `packages/create-yeti-agent-py` | `create-yeti-agent` (PyPI, `uvx`) | Python scaffolder |

## Build and test

TypeScript (Node 18+, npm):

```bash
npm ci          # install from the lockfile
npm run build   # tsc typecheck + emit, both TS packages
npm test        # jest, both TS packages
```

Python (uv, Python 3.11):

```bash
# runtime tests (pytest)
cd packages/arena-runtime-py
uv venv --python 3.11 .venv && uv pip install -e ".[dev]"
.venv/bin/pytest -q

# scaffolder tests (stdlib unittest)
cd packages/create-yeti-agent-py
uv venv --python 3.11 .venv && uv pip install -e .
.venv/bin/python tests/test_resolve.py
.venv/bin/python tests/test_styles.py
```

`./test-all.sh` runs the TS tests, the Python runtime tests, and a Python
scaffolder import smoke in one pass. It is the pre-publish pre-flight.

CI (`.github/workflows/ci.yml`) runs typecheck + tests for TS and Python on every
PR and on pushes to `main`. Keep it green.

## PR conventions

- Conventional commit subjects, scoped to the package touched: `fix(runtime):`,
  `feat(create-yeti-agent-py):`, `docs:`, `chore:`. Match the existing history
  (`git log --oneline`).
- One focused change per PR; leave unrelated files alone.
- Keep the arena protocol stable. The backend (`yetifi_trader_backend`) owns
  `/api/arena/*`; protocol changes ship as a coordinated version bump, not a
  silent edit here.
- Bump the version in the touched package's manifest (`package.json` /
  `pyproject.toml`) when a change is publishable.
- Publishing order: runtimes first, then scaffolders (the scaffolders pin
  `RUNTIME_VERSION`). See the README.

## Notes

- `packages/create-yeti-agent/templates/*/AGENTS.md` is a template copied into
  generated user projects, not this repo's agent guide.
- `packages/arena-runtime-ts/src/types.generated.ts` is gitignored; regenerate
  with `npm run codegen`.
- `.venv/` directories are gitignored and created fresh in CI.
