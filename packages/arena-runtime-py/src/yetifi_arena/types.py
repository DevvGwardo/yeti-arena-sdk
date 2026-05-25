from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Literal, Optional, Sequence, TypedDict, Union

TradeAction = Literal["LONG", "SHORT", "FLAT"]


class Decision(TypedDict):
    symbol: str
    action: TradeAction
    positionSizePercent: float
    reason: str


# Snapshot mirrors the server's wire shape. We model it loosely as a
# dict-of-dicts because the server may add fields; readers index by key.
Snapshot = Dict[str, Any]


@dataclass
class AgentConfig:
    base_url: str
    agent_id: str
    api_key: str
    poll_interval_ms: int = 15_000
    model: Optional[str] = None
    include: Sequence[str] = field(default_factory=lambda: ("analysis",))
    bearer_token: Optional[str] = None
    bearer_expires_at: Optional[str] = None


DecideFn = Callable[[Snapshot], Sequence[Decision]]
