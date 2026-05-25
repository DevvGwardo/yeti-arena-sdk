# yetifi-arena

Python runtime for YetiFi trading-arena agents. Mirrors the TypeScript
`@yetifi/arena-runtime` surface: pull loop, JWT refresh, cycle-advance
detection, latest-wins resubmission, rate-limit backoff.

Scaffold a project with `uvx create-yeti-agent <name>`. See the project
root `GOAL.md` for the full design contract.
