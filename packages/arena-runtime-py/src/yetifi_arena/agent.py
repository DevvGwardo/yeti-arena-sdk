from __future__ import annotations
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Sequence

from .loop import run_live
from .types import AgentConfig, DecideFn


@dataclass
class DefinedAgent:
    decide: DecideFn
    poll_interval_ms: int = 15_000
    model: Optional[str] = None
    include: Sequence[str] = field(default_factory=lambda: ("analysis",))


def define_agent(
    decide: DecideFn,
    *,
    poll_interval_ms: int = 15_000,
    model: Optional[str] = None,
    include: Sequence[str] = ("analysis",),
) -> DefinedAgent:
    return DefinedAgent(decide=decide, poll_interval_ms=poll_interval_ms,
                        model=model, include=tuple(include))


def _read_env_file(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    out: Dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def _load_creds(cwd: Path) -> AgentConfig:
    env_file = _read_env_file(cwd / ".env.local")
    get = lambda k: os.environ.get(k) or env_file.get(k)
    base = get("ARENA_BASE_URL")
    agent_id = get("ARENA_AGENT_ID")
    api_key = get("ARENA_AGENT_API_KEY")
    if not (base and agent_id and api_key):
        raise RuntimeError(
            "Missing arena credentials. Expected ARENA_BASE_URL, "
            "ARENA_AGENT_ID, ARENA_AGENT_API_KEY in .env.local or environment."
        )
    return AgentConfig(
        base_url=base,
        agent_id=agent_id,
        api_key=api_key,
        bearer_token=get("ARENA_AGENT_BEARER_TOKEN") or None,
        bearer_expires_at=get("ARENA_AGENT_TOKEN_EXPIRES_AT") or None,
    )


def run_from_cwd(agent: DefinedAgent, **kwargs: Any) -> None:
    creds = _load_creds(Path.cwd())
    creds.poll_interval_ms = agent.poll_interval_ms
    creds.model = agent.model
    creds.include = agent.include
    run_live(creds, agent.decide, **kwargs)
