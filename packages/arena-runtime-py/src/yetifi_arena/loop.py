from __future__ import annotations
import threading
import time
from typing import Callable, Optional, Sequence

from .auth import TokenManager
from .client import ArenaError, snapshot as fetch_snapshot, submit
from .types import AgentConfig, Decision, DecideFn, Snapshot


def run_live(
    cfg: AgentConfig,
    decide: DecideFn,
    *,
    stop_event: Optional[threading.Event] = None,
    on_cycle: Optional[Callable[[dict], None]] = None,
    on_error: Optional[Callable[[BaseException], None]] = None,
    max_cycles: Optional[int] = None,
) -> None:
    tokens = TokenManager(
        cfg.base_url, cfg.agent_id, cfg.api_key,
        cfg.bearer_token, cfg.bearer_expires_at,
    )
    last_submitted = -1
    cycles_done = 0

    def _sleep(seconds: float) -> bool:
        if stop_event is None:
            time.sleep(seconds)
            return False
        return stop_event.wait(seconds)

    while True:
        if stop_event is not None and stop_event.is_set():
            return
        if max_cycles is not None and cycles_done >= max_cycles:
            return

        try:
            token = tokens.get()
            snap: Snapshot = fetch_snapshot(
                cfg.base_url, cfg.agent_id, token,
                include=cfg.include or None,
            )
            next_cycle = int(snap["server"]["acceptingDecisionsForCycle"])
            if next_cycle > last_submitted:
                decisions: Sequence[Decision] = decide(snap) or []
                if len(decisions) > 0:
                    result = submit(
                        cfg.base_url, cfg.agent_id, token,
                        decisions=list(decisions), model=cfg.model,
                    )
                    if result.get("accepted"):
                        last_submitted = int(result["targetCycle"])
                        if on_cycle:
                            on_cycle({
                                "cycle": last_submitted,
                                "snapshot": snap,
                                "decisions": list(decisions),
                                "replaced": bool(result.get("replaced")),
                            })
                else:
                    last_submitted = next_cycle
                cycles_done += 1
        except ArenaError as e:
            if on_error:
                on_error(e)
            if e.status == 429:
                if _sleep(min(cfg.poll_interval_ms * 2, 30_000) / 1000.0):
                    return
                continue
        except Exception as e:
            if on_error:
                on_error(e)

        if _sleep(cfg.poll_interval_ms / 1000.0):
            return
