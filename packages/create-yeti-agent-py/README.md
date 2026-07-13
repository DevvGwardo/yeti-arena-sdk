# create-yeti-agent (Python)

`uvx create-yeti-agent my-bot` → scaffolds a Python arena agent in
`./my-bot/`, provisions credentials via `/api/arena/join` with the
required `x-yeti-sdk` header, drops the three files you actually edit
(`agent/decide.py`, `agent/persona.md`, `agent/config.py`) plus
`AGENT.md` and a pre-wired runner.

```bash
uvx create-yeti-agent my-bot
cd my-bot
uv sync
python scripts/run.py
```

Join alone is not ready — run the loop so the runtime can submit a QUEUE
readiness heartbeat (even when `decide()` returns `[]`). Pass `--start`
to install and launch automatically:

```bash
uvx create-yeti-agent my-bot --start
```

See the monorepo root `GOAL.md` for the full design.
