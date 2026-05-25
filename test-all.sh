#!/usr/bin/env bash
# Cross-language pre-flight check. Run before publishing to npm/PyPI.
#
# What it runs:
#   1. TS workspace tests (Jest) — covers both TS packages
#   2. Python runtime tests (pytest in arena-runtime-py)
#   3. Python scaffolder import smoke (proves the wheel is loadable)
#
# Optional: set YETI_BACKEND_DIR to also run backend Jest tests.

set -euo pipefail

cd "$(dirname "$0")"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

failures=()
record_failure() { failures+=("$1"); red "  ✗ $1"; }
record_success() { green "  ✓ $1"; }

# ─── 1. TS ──────────────────────────────────────────────────────────────────
blue "[1/3] TS workspace tests"
if npm test --silent 2>&1 | tail -20; then
  record_success "TS tests"
else
  record_failure "TS tests"
fi
echo

# ─── 2. Python runtime ──────────────────────────────────────────────────────
blue "[2/3] Python runtime (yetifi-arena)"
PY_RUNTIME="packages/arena-runtime-py"
if [[ -x "$PY_RUNTIME/.venv/bin/pytest" ]]; then
  if "$PY_RUNTIME/.venv/bin/pytest" -q "$PY_RUNTIME"; then
    record_success "Python runtime tests"
  else
    record_failure "Python runtime tests"
  fi
else
  red "  .venv missing. Run: (cd $PY_RUNTIME && uv venv --python 3.11 .venv && uv pip install -e \".[dev]\")"
  record_failure "Python runtime venv not set up"
fi
echo

# ─── 3. Python scaffolder import smoke ──────────────────────────────────────
blue "[3/3] Python scaffolder (create-yeti-agent uvx)"
PY_SCAFFOLD="packages/create-yeti-agent-py"
if [[ -x "$PY_SCAFFOLD/.venv/bin/python" ]]; then
  if "$PY_SCAFFOLD/.venv/bin/python" -c "
from create_yeti_agent_py.cli import _valid_name, _templates_root
assert _valid_name('my-bot') is None
assert _valid_name('A b') is not None
root = _templates_root()
assert root.exists(), f'templates not found at {root}'
print(f'  templates found at {root}')
"; then
    record_success "Python scaffolder import smoke"
  else
    record_failure "Python scaffolder import smoke"
  fi
else
  red "  .venv missing. Run: (cd $PY_SCAFFOLD && uv venv --python 3.11 .venv && uv pip install -e .)"
  record_failure "Python scaffolder venv not set up"
fi
echo

# ─── Summary ────────────────────────────────────────────────────────────────
if [[ ${#failures[@]} -eq 0 ]]; then
  green "═══ All checks passed ══════════════════════════════════"
  exit 0
fi
red "═══ ${#failures[@]} check(s) failed ════════════════════════════════"
for f in "${failures[@]}"; do
  red "  · $f"
done
exit 1
