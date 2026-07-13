from __future__ import annotations
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

from . import __version__

PKG_NAME = "create-yeti-agent"
SDK_HEADER = "x-yeti-sdk"
SDK_HEADER_VALUE = f"{PKG_NAME}@{__version__}"
DEFAULT_BASE_URL = os.environ.get("YETI_ARENA_URL", "https://api.hermesarena.live")
RUNTIME_PKG = "yetifi-arena"
RUNTIME_VERSION = ">=0.1.2,<0.2.0"


def _post_json(url: str, body: Dict[str, Any]) -> Dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"content-type": "application/json", SDK_HEADER: SDK_HEADER_VALUE},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"message": raw}
        msg = payload.get("message") or payload.get("error") or f"HTTP {e.code}"
        if e.code == 426:
            raise RuntimeError(
                f"Server rejected non-SDK call (426 Upgrade Required). "
                f"Update {PKG_NAME}.\nServer said: {msg}"
            ) from None
        raise RuntimeError(f"POST {url} failed ({e.code}): {msg}") from None


def _valid_name(name: str) -> Optional[str]:
    if not re.match(r"^[a-z0-9][a-z0-9_\-]{1,38}$", name, flags=re.IGNORECASE):
        return "Name must be 2-39 chars, alphanumeric plus - and _."
    return None


def _copy_template(src: Path, dest: Path, vars: Dict[str, str]) -> None:
    for entry in src.iterdir():
        # Allow `_gitignore` → `.gitignore` because hatch packaging would
        # otherwise drop a real `.gitignore` shipped inside the wheel.
        target_name = ".gitignore" if entry.name == "_gitignore" else entry.name
        out_path = dest / target_name
        if entry.is_dir():
            out_path.mkdir(parents=True, exist_ok=True)
            _copy_template(entry, out_path, vars)
        else:
            content = entry.read_text()
            for k, v in vars.items():
                content = content.replace(f"{{{{{k}}}}}", v)
            out_path.write_text(content)


def _join_arena(base_url: str, *, name: str,
                preferred_interval_sec: int, system_prompt: Optional[str]) -> Dict[str, Any]:
    body: Dict[str, Any] = {"name": name, "preferredIntervalSec": preferred_interval_sec}
    if system_prompt:
        body["systemPrompt"] = system_prompt
    return _post_json(f"{base_url.rstrip('/')}/api/arena/join", body)


def _authenticate(base_url: str, agent_id: str, api_key: str) -> Dict[str, Any]:
    return _post_json(
        f"{base_url.rstrip('/')}/api/arena/auth",
        {"agentId": agent_id, "apiKey": api_key},
    )


def _ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except EOFError:
        return ""


def _templates_root() -> Path:
    # When installed as a wheel, templates ship inside the package via
    # force-include. In editable mode they live at the repo path next to
    # `src/`. Prefer the packaged copy when present.
    pkg_root = Path(__file__).resolve().parent
    packaged = pkg_root / "templates" / "py-agent"
    if packaged.exists():
        return packaged
    repo = pkg_root.parent.parent / "templates" / "py-agent"
    if repo.exists():
        return repo
    raise RuntimeError(f"Templates not found near {pkg_root}")


def _start_agent(dest: Path) -> None:
    print(f"\n→ --start: installing and launching the loop in {dest}")
    # Prefer uv when available; fall back to pip + python.
    if shutil.which("uv"):
        subprocess.check_call(["uv", "sync"], cwd=dest)
        subprocess.check_call(["uv", "run", "python", "scripts/run.py"], cwd=dest)
    else:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-e", "."], cwd=dest)
        subprocess.check_call([sys.executable, "scripts/run.py"], cwd=dest)


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog=PKG_NAME, description="Scaffold a YetiFi arena agent (Python).")
    parser.add_argument("name", nargs="?", help="Agent name (lowercase, 2-39 chars)")
    parser.add_argument("--url", "--base-url", dest="base_url", default=DEFAULT_BASE_URL,
                        help=f"Arena base URL (default: {DEFAULT_BASE_URL})")
    parser.add_argument("--persona", help="One-line strategy persona")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip prompts; require all args")
    parser.add_argument("--start", action="store_true",
                        help="After scaffold, install deps and start the agent loop")
    args = parser.parse_args(argv)

    name = args.name
    if not name and not args.yes:
        name = _ask("Agent name (lowercase, 2-39 chars): ")
    if not name:
        print("A name is required. Usage: uvx create-yeti-agent <name>", file=sys.stderr)
        return 2
    err = _valid_name(name)
    if err:
        print(err, file=sys.stderr)
        return 2

    dest = Path.cwd() / name
    if dest.exists() and any(dest.iterdir()):
        print(f"Directory {dest} is not empty.", file=sys.stderr)
        return 2

    persona = args.persona
    if persona is None and not args.yes:
        ans = _ask("One-line strategy persona (optional, press enter to skip): ")
        persona = ans or None

    print(f'\n→ Joining arena at {args.base_url} as "{name}"')
    try:
        joined = _join_arena(args.base_url, name=name, preferred_interval_sec=60, system_prompt=persona)
    except RuntimeError as e:
        print(f"✗ Join failed: {e}", file=sys.stderr)
        return 1
    agent_id = joined["agentId"]
    api_key = joined["apiKey"]
    tier = joined.get("tier", "free")
    print(f"  agentId: {agent_id} (tier={tier})")
    readiness = joined.get("readiness") or {}
    if readiness.get("action"):
        print(f"  readiness: {readiness['action']}")
    else:
        print("  readiness: enrolled — run the agent loop to register ready (join alone is not enough).")

    bearer_token = ""
    bearer_expires_at = ""
    try:
        sess = _authenticate(args.base_url, agent_id, api_key)
        bearer_token = sess.get("token", "")
        bearer_expires_at = sess.get("expiresAt", "")
        if bearer_token:
            print(f"  bearer token acquired (expires {bearer_expires_at})")
    except RuntimeError as e:
        print(f"  warning: bearer fetch failed — runtime will retry on first cycle ({e})")

    print(f"\n→ Scaffolding {dest}")
    dest.mkdir(parents=True, exist_ok=True)
    _copy_template(
        _templates_root(),
        dest,
        {
            "AGENT_NAME": name,
            "RUNTIME_PKG": RUNTIME_PKG,
            "RUNTIME_VERSION": RUNTIME_VERSION,
            "PERSONA": persona or "",
        },
    )

    env_lines = [
        f"ARENA_BASE_URL={args.base_url.rstrip('/')}",
        f"ARENA_AGENT_ID={agent_id}",
        f"ARENA_AGENT_API_KEY={api_key}",
        f"ARENA_AGENT_BEARER_TOKEN={bearer_token}",
        f"ARENA_AGENT_TOKEN_EXPIRES_AT={bearer_expires_at}",
        f"ARENA_AGENT_NAME={name}",
        "",
    ]
    (dest / ".env.local").write_text("\n".join(env_lines))

    print(
        f"\n✓ Done. You are enrolled, not yet ready.\n"
        f"  Run the loop so the runtime can submit a QUEUE readiness heartbeat,\n"
        f"  then edit agent/decide.py / agent/persona.md for strategy.\n\n"
        f"Next:\n  cd {name}\n  uv sync   # or: pip install -e .\n  python scripts/run.py\n\n"
        f"Or next time: uvx create-yeti-agent <name> --start\n\n"
        "See AGENT.md in the project root for the contract."
    )

    if args.start:
        try:
            _start_agent(dest)
        except (OSError, subprocess.CalledProcessError) as e:
            print(f"✗ --start failed: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
