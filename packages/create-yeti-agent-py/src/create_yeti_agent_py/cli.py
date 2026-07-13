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
from typing import Any, Dict, List, Optional, Tuple

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


def _get_json(url: str, *, timeout: float = 8.0) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers={"accept": "application/json"}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


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


def _join_arena(
    base_url: str,
    *,
    name: str,
    preferred_interval_sec: int,
    system_prompt: Optional[str],
    style_id: Optional[str] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {"name": name, "preferredIntervalSec": preferred_interval_sec}
    if system_prompt:
        body["systemPrompt"] = system_prompt
    if style_id:
        body["styleId"] = style_id
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


def _styles_fallback_path() -> Path:
    pkg_root = Path(__file__).resolve().parent
    packaged = pkg_root / "styles" / "fallback.json"
    if packaged.exists():
        return packaged
    repo = pkg_root.parent.parent / "styles" / "fallback.json"
    if repo.exists():
        return repo
    raise RuntimeError(f"Style fallback not found near {pkg_root}")


def load_fallback_styles() -> List[Dict[str, Any]]:
    data = json.loads(_styles_fallback_path().read_text())
    styles = data.get("styles")
    if not isinstance(styles, list) or not styles:
        raise RuntimeError("Style fallback.json is empty or malformed")
    return styles


def fetch_styles(base_url: str) -> Tuple[List[Dict[str, Any]], str]:
    """Return (styles, source) where source is 'remote' or 'fallback'."""
    url = f"{base_url.rstrip('/')}/api/arena/styles"
    try:
        payload = _get_json(url)
        styles = payload.get("styles")
        if isinstance(styles, list) and styles:
            return styles, "remote"
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError) as e:
        print(f"  warning: could not fetch styles from {url} ({e}); using bundled fallback")
    return load_fallback_styles(), "fallback"


def resolve_style(styles: List[Dict[str, Any]], style_id: str) -> Dict[str, Any]:
    for s in styles:
        if isinstance(s, dict) and s.get("id") == style_id:
            return s
    known = ", ".join(str(s.get("id")) for s in styles if isinstance(s, dict))
    raise ValueError(f'Unknown style "{style_id}". Valid: {known}')


def pick_style_interactive(styles: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    print("\nTrading styles (rules-based decide.py — no LLM key required):")
    for i, s in enumerate(styles, start=1):
        print(f"  {i}. {s.get('id')} — {s.get('label')}: {s.get('blurb')}")
    print("  0. skip / custom persona")
    ans = _ask("Pick a style number (default 1=momentum): ")
    if ans == "" or ans == "1":
        return styles[0] if styles else None
    if ans in ("0", "skip", "none"):
        return None
    if ans.isdigit():
        idx = int(ans)
        if 1 <= idx <= len(styles):
            return styles[idx - 1]
    # Also accept raw style id
    try:
        return resolve_style(styles, ans)
    except ValueError:
        print(f"  unknown choice {ans!r}; skipping style")
        return None


def apply_style(dest: Path, style: Dict[str, Any], agent_name: str) -> None:
    persona = str(style.get("persona") or "").strip()
    decide_py = str(style.get("decidePy") or "").strip()
    if not decide_py:
        raise ValueError(f'Style "{style.get("id")}" is missing decidePy')

    persona_md = (
        f"# {agent_name} — Persona\n\n"
        f"{persona}\n\n"
        "This file is uploaded as your agent's `systemPrompt` on join and is the "
        "human-readable record of how this bot is supposed to behave. Update it "
        "whenever your strategy changes.\n"
    )
    (dest / "agent" / "persona.md").write_text(persona_md)
    (dest / "agent" / "decide.py").write_text(decide_py if decide_py.endswith("\n") else decide_py + "\n")


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
    parser.add_argument("--persona", help="Custom strategy persona (overrides style persona text on join)")
    parser.add_argument(
        "--style",
        help="Trading style id from GET /api/arena/styles (momentum|mean_reversion|conservative|degen)",
    )
    parser.add_argument("--yes", "-y", action="store_true", help="Skip prompts; require all args")
    parser.add_argument("--start", action="store_true",
                        help="After scaffold, install deps and start the agent loop")
    args = parser.parse_args(argv)

    name = args.name
    if not name and not args.yes:
        name = _ask("Agent name (lowercase, 2-39 chars): ")
    if not name:
        print("A name is required. Usage: uvx create-yeti-agent <name> --style momentum --start", file=sys.stderr)
        return 2
    err = _valid_name(name)
    if err:
        print(err, file=sys.stderr)
        return 2

    dest = Path.cwd() / name
    if dest.exists() and any(dest.iterdir()):
        print(f"Directory {dest} is not empty.", file=sys.stderr)
        return 2

    print(f"\n→ Loading styles from {args.base_url}")
    styles, styles_source = fetch_styles(args.base_url)
    print(f"  {len(styles)} styles ({styles_source})")

    selected_style: Optional[Dict[str, Any]] = None
    if args.style:
        try:
            selected_style = resolve_style(styles, args.style)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
    elif args.persona is None and not args.yes:
        selected_style = pick_style_interactive(styles)

    persona = args.persona
    if persona is None and selected_style is not None:
        persona = str(selected_style.get("persona") or "") or None
    elif persona is None and not args.yes and selected_style is None:
        ans = _ask("One-line strategy persona (optional, press enter to skip): ")
        persona = ans or None

    style_id = str(selected_style["id"]) if selected_style else None

    print(f'\n→ Joining arena at {args.base_url} as "{name}"')
    if style_id:
        print(f"  style: {style_id}")
    try:
        joined = _join_arena(
            args.base_url,
            name=name,
            preferred_interval_sec=60,
            system_prompt=persona,
            style_id=style_id,
        )
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
    if selected_style is not None:
        apply_style(dest, selected_style, name)
        print(f"  applied style `{style_id}` → agent/decide.py + agent/persona.md")

    env_lines = [
        f"ARENA_BASE_URL={args.base_url.rstrip('/')}",
        f"ARENA_AGENT_ID={agent_id}",
        f"ARENA_AGENT_API_KEY={api_key}",
        f"ARENA_AGENT_BEARER_TOKEN={bearer_token}",
        f"ARENA_AGENT_TOKEN_EXPIRES_AT={bearer_expires_at}",
        f"ARENA_AGENT_NAME={name}",
        "",
    ]
    if style_id:
        env_lines.insert(-1, f"ARENA_AGENT_STYLE={style_id}")
    (dest / ".env.local").write_text("\n".join(env_lines))

    print(
        f"\n✓ Done. You are enrolled, not yet ready.\n"
        f"  Run the loop so the runtime can submit a QUEUE readiness heartbeat,\n"
        f"  then edit agent/decide.py / agent/persona.md for strategy.\n\n"
        f"Next:\n"
        f"  cd {name} && uv sync && python scripts/run.py\n\n"
        f"Or next time (one shot):\n"
        f"  uvx create-yeti-agent <name> --style {style_id or 'momentum'} --start\n\n"
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
