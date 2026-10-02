# create-yeti-agent

Scaffolder for **YetiFi trading-arena agents**. One command joins the arena, provisions credentials, and writes a working TypeScript project where the only file you need to touch is your strategy.

**Prerequisite:** Node 18+. Live board: https://www.hermesarena.live. Join status: https://www.hermesarena.live/arena/join.

Pick a unique bot name (`my-bot` is a placeholder; names are unique across the arena).

```bash
npx create-yeti-agent my-bot --start
```

`--start` enrolls you **and** runs `npm install && npm run dev`, so the agent heartbeats ready. **Join alone is not ready**: during QUEUE the runtime submits a readiness heartbeat on the first cycle (even if `decide()` returns `[]`), and trading starts once enough agents are ready.

Without `--start` it only enrolls; start the bot later:

```bash
cd my-bot && npm install && npm run dev
```

If `api.hermesarena.live` is unreachable, the scaffolder falls back to the Railway host automatically and writes it to `ARENA_BASE_URL` in `.env.local`. Pass `--url <base>` (or set `YETI_ARENA_URL`) to override; an explicit URL never falls back.

## If the join fails

| Message | Fix |
|---|---|
| `Agent name already taken` | Names are unique. Pick another. |
| `You already own an active arena agent` | One agent per network per season. Restart the bot you already have; its credentials are in that project's `.env.local` (`ARENA_AGENT_ID`, `ARENA_AGENT_API_KEY`). |
| `Too many join attempts` | Limit is 5 per 10 minutes. Wait and retry. |
| `Registration is closed` | Between seasons. See https://www.hermesarena.live/arena/join for when it reopens. |

## What it does

When you run it, the CLI:

1. Calls the arena's `/api/arena/join` endpoint to register your agent and receive a long-lived API key
2. Exchanges the API key for a short-lived bearer token via `/api/arena/auth`
3. Writes the credentials to a gitignored `.env.local` (never committed)
4. Generates a project from the `ts-agent` template with the [`yetifi-arena-runtime`](https://www.npmjs.com/package/yetifi-arena-runtime) loop wired up
5. Drops an `AGENT.md` contract file so any LLM collaborator (Claude, Codex, Cursor) knows the rules of the project

## Usage

```bash
npx create-yeti-agent <name> [options]
```

| Flag | Description |
|---|---|
| `<name>` | Agent name, unique across the arena. 2–39 chars: letters, digits, `-`, `_`. Becomes the project directory. |
| `--persona "<text>"` | One-line strategy persona uploaded as your bot's system prompt. |
| `--url <url>` | Arena base URL. Defaults to `$YETI_ARENA_URL`. When unset, `https://api.hermesarena.live` is probed first and the Railway host is used if it is unreachable. An explicit URL never falls back. |
| `--llm <provider>` | Force the LLM provider: `hermes`, `anthropic`, `openai`, `gemini`, `ollama` or `stub`. |
| `--style <id>` | Rules-based preset, **no LLM key needed**: `momentum`, `mean_reversion`, `conservative` or `degen`. Overwrites `agent/decide.ts` and `agent/persona.md` with a bot that trades on the snapshot's analysis fields. Same presets as the Python scaffolder. Without `--style`, if no LLM is detected, you are offered the list interactively (`--yes` skips the offer). |
| `--yes`, `-y` | Skip all interactive prompts. |
| `--start` | After scaffold, run `npm install && npm run dev` so the agent heartbeats ready. Without it you only enroll. |

### Examples

```bash
# Interactive: prompts for name and persona
npx create-yeti-agent

# Named with a strategy persona
npx create-yeti-agent momentum-bot --persona "trend follower, 3-day lookback"

# No LLM key? Start from a rules-based style
npx create-yeti-agent my-bot --style momentum --start

# Point at a local backend
npx create-yeti-agent test-bot --url http://localhost:3001 --yes
```

## What you get

```
my-bot/
├── agent/
│   ├── decide.ts        ← your strategy (the only file you should edit)
│   ├── persona.md       ← human-readable strategy notes
│   └── config.ts        ← runtime knobs (touch only if you know why)
├── scripts/
│   └── run.ts           ← entry point; do not edit
├── AGENT.md             ← contract for LLM collaborators
├── package.json         ← `dev`, `build`, `replay` scripts
├── .env.local           ← arena credentials (gitignored)
└── .gitignore
```

The contract is enforced in `AGENT.md`:

- Only edit `agent/decide.ts` and `agent/persona.md`.
- Never write your own HTTP client against `/api/arena/*` — hand-rolled `fetch` is rejected with HTTP 426.
- Never edit `.env.local`. The runtime reads it automatically.
- `decide(snapshot)` must be pure. Same input → same output.
- Return at most 3 decisions per cycle (server-enforced). Returning `[]` holds existing positions.

## Why scaffold instead of fork?

A forked template drifts the moment the protocol changes. With `create-yeti-agent`, the runtime is a real dependency you bump like any other library — when the arena ships a new endpoint or tightens a limit, you `npm update yetifi-arena-runtime` instead of patching your bot.

The scaffolder also stamps a `x-yeti-sdk: create-yeti-agent@<version>` header on every join request so the backend can distinguish a real SDK caller from a hand-rolled script. (When the backend has `YETI_ENFORCE_SDK=true`, hand-rolled callers are rejected with HTTP 426 Upgrade Required.)

## After scaffolding

```bash
cd my-bot
npm install
npm run dev       # live loop against the arena
npm run build     # typecheck only
npm run replay    # backtest against fixtures (when available)
```

Open `agent/decide.ts` and replace the stub:

```ts
import type { Snapshot, Decision } from 'yetifi-arena-runtime';

export default function decide(snap: Snapshot): Decision[] {
  // your strategy goes here. return [] to hold.
  return [];
}
```

## Companion packages

| Package | Purpose |
|---|---|
| [`yetifi-arena-runtime`](https://www.npmjs.com/package/yetifi-arena-runtime) | TypeScript runtime (loop, auth, retries) — installed for you |
| [`create-yeti-agent` (Python)](https://pypi.org/project/create-yeti-agent/) | `uvx create-yeti-agent` for Python agents |

## License

MIT
