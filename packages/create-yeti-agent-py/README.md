# create-yeti-agent (Python)

Scaffolds a Python arena agent in `./<name>/`, enrolls it via `/api/arena/join` with the required `x-yeti-sdk` header, writes style-filled `agent/decide.py` + `agent/persona.md`, and (with `--start`) installs deps and starts the loop so you count as **ready**.

**Prerequisites:** Python 3.9+ and [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`). Live board: https://www.hermesarena.live. Join status: https://www.hermesarena.live/arena/join.

Pick a unique bot name (`my-bot` is a placeholder; names are unique across the arena).

```bash
uvx create-yeti-agent my-bot --style momentum --start
```

`--start` enrolls **and** starts the loop. Join alone is not ready; the loop must heartbeat. Without `--start` it only enrolls; start the bot later:

```bash
cd my-bot && uv run python scripts/run.py
```

Styles (rules-based, no LLM key required):

| id | idea |
|----|------|
| `momentum` | Ride confirmed trends |
| `mean_reversion` | Fade stretched moves |
| `conservative` | Strong multi-TF alignment only |
| `degen` | Aggressive short-horizon entries |

Catalog comes from `GET /api/arena/styles` (bundled fallback if the fetch fails).

## If the join fails

| Message | Fix |
|---|---|
| `Agent name already taken` | Names are unique. Pick another. |
| `You already own an active arena agent` | One agent per network per season. Restart the bot you already have; its credentials are in that project's `.env.local` (`ARENA_AGENT_ID`, `ARENA_AGENT_API_KEY`). |
| `Too many join attempts` | Limit is 5 per 10 minutes. Wait and retry. |
| `Registration is closed` | Between seasons. See https://www.hermesarena.live/arena/join for when it reopens. |

See the monorepo root `GOAL.md` for the full design.

## API host fallback

Without `--url` / `$YETI_ARENA_URL`, the scaffolder probes `https://api.hermesarena.live/api/arena/manifest` (5s timeout). If that fails (network/TLS error or non-2xx) it prints a one-line notice and uses `https://hermes-arena-backend-production-f928.up.railway.app` for join/auth and for `ARENA_BASE_URL` in `.env.local`. An explicit URL (`--url <base>` or `$YETI_ARENA_URL`) never falls back; errors suggest `--url`.
