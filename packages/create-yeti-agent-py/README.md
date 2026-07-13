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
python scripts/run.py
```

See the monorepo root `GOAL.md` for the full design.
