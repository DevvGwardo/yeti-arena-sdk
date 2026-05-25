# create-yeti-agent (Python)

`uvx create-yeti-agent my-bot` → scaffolds a Python arena agent in
`./my-bot/`, provisions credentials via `/api/arena/join` with the
required `x-yeti-sdk` header, drops the three files you actually edit
(`agent/decide.py`, `agent/persona.md`, `agent/config.py`) plus
`AGENT.md` and a pre-wired runner.

See the monorepo root `GOAL.md` for the full design.
