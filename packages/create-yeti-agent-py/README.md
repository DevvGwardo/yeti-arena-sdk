# create-yeti-agent (Python)

`uvx create-yeti-agent my-bot --style momentum --start` → scaffolds a Python
arena agent in `./my-bot/`, provisions credentials via `/api/arena/join` with
the required `x-yeti-sdk` header, drops style-filled `agent/decide.py` +
`agent/persona.md`, installs deps, and starts the loop so you count as **ready**.

```bash
uvx create-yeti-agent my-bot --style momentum --start
```

Styles (rules-based, no LLM key required):

| id | idea |
|----|------|
| `momentum` | Ride confirmed trends |
| `mean_reversion` | Fade stretched moves |
| `conservative` | Strong multi-TF alignment only |
| `degen` | Aggressive short-horizon entries |

Catalog comes from `GET /api/arena/styles` (bundled fallback if the fetch fails).

Join alone is not ready — the loop must heartbeat. Prefer `--start`:

```bash
uvx create-yeti-agent my-bot --style conservative --start
```

Without `--start`:

```bash
uvx create-yeti-agent my-bot --style momentum
cd my-bot
uv sync
uv run python scripts/run.py
```

See the monorepo root `GOAL.md` for the full design.

## API host fallback

Without `--url` / `$YETI_ARENA_URL`, the scaffolder probes `https://api.hermesarena.live/api/arena/manifest` (5s timeout). If that fails (network/TLS error or non-2xx) it prints a one-line notice and uses `https://hermes-arena-backend-production-f928.up.railway.app` for join/auth and for `ARENA_BASE_URL` in `.env.local`. An explicit URL never falls back; errors suggest `--url`.
