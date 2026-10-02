"""Full-cycle test: scaffold a momentum bot against the local mock arena, run
it for a couple of cycles, and assert the mock received valid decisions.

Usage (from repo root):
  uv run --project packages/create-yeti-agent-py python packages/create-yeti-agent-py/tests/cycle_e2e.py

Installs packages/arena-runtime-py (editable) into the scaffolded venv so the
local runtime is exercised instead of the PyPI release. Never contacts prod.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mock_arena import MockArena  # noqa: E402

REPO = Path(__file__).resolve().parents[3]


def run(cmd, cwd, **kw):
    return subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, **kw)


def main() -> int:
    mock = MockArena().start()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            r = run(["uv", "run", "--project", str(REPO / "packages/create-yeti-agent-py"),
                     "create-yeti-agent", "cycle-bot", "--style", "momentum", "--yes", "--url", mock.url], tmp)
            print(r.stdout, r.stderr)
            assert r.returncode == 0, "scaffold failed"
            proj = Path(tmp) / "cycle-bot"
            cfg = proj / "agent" / "config.py"
            cfg.write_text(re.sub(r"poll_interval_ms=\d[\d_]*", "poll_interval_ms=1_000", cfg.read_text()))
            env = {**os.environ, "PYTHONUNBUFFERED": "1"}
            env.pop("VIRTUAL_ENV", None)  # don't leak the parent `uv run` venv
            for cmd in (["uv", "venv", "-q"],
                        ["uv", "pip", "install", "-q", "--python", str(proj / ".venv/bin/python"),
                         "-e", str(REPO / "packages/arena-runtime-py")]):
                p = run(cmd, proj, env=env)
                assert p.returncode == 0, p.stderr
            proc = subprocess.Popen([str(proj / ".venv/bin/python"), "scripts/run.py"], cwd=proj, env=env,
                                    text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            deadline = time.time() + 30
            while time.time() < deadline and len(mock.decisions) < 2:
                time.sleep(0.2)
            proc.terminate()
            out, _ = proc.communicate(timeout=10)
            print("--- bot output ---\n" + out)
        print("--- mock decisions ---")
        for d in mock.decisions:
            print(d)
        assert len(mock.decisions) >= 2, "expected >=2 decision POSTs"
        for d in mock.decisions:
            assert {x["symbol"] for x in d["decisions"]} == {"BTC", "ETH"}
            assert {x["symbol"]: x["action"] for x in d["decisions"]} == {"BTC": "LONG", "ETH": "SHORT"}
        assert [d["targetCycle"] for d in mock.decisions[:2]] == [5, 6]
        assert "[loop error]" not in out
        print("OK: full cycle verified")
        return 0
    finally:
        mock.stop()


if __name__ == "__main__":
    raise SystemExit(main())
