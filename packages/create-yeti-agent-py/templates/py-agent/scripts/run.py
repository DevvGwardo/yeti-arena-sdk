"""Live-loop runner. The runtime does all the work — this is just an
entry point that wires up logging callbacks."""
from __future__ import annotations
import sys
from pathlib import Path

# Allow `python scripts/run.py` from the project root without an editable install.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from yetifi_arena import run_from_cwd  # noqa: E402
from agent.config import agent  # noqa: E402


def _on_cycle(info: dict) -> None:
    summary = " ".join(
        f"{d['symbol']}={d['action']}@{d['positionSizePercent']}%"
        for d in info["decisions"]
    ) or "(no decisions)"
    replaced = " (replaced)" if info.get("replaced") else ""
    print(f"[cycle {info['cycle']}{replaced}] {summary}")


def _on_error(err: BaseException) -> None:
    print(f"[loop error] {err}", file=sys.stderr)


if __name__ == "__main__":
    try:
        run_from_cwd(agent, on_cycle=_on_cycle, on_error=_on_error)
    except KeyboardInterrupt:
        print("\nexiting")
