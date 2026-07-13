from __future__ import annotations
import threading
import time
from typing import Callable, List, Optional, Sequence

from .auth import TokenManager
from .client import ArenaError, snapshot as fetch_snapshot, submit
from .types import AgentConfig, Decision, DecideFn, Snapshot


def needs_queue_heartbeat(snap: Snapshot, decisions: Sequence[Decision]) -> bool:
    """True when QUEUE + not ready + empty decide — runtime must inject a FLAT heartbeat."""
    readiness = snap.get("readiness") or {}
    return (
        readiness.get("phase") == "QUEUE"
        and readiness.get("agentReady") is not True
        and len(decisions) == 0
    )


def build_queue_heartbeat_decision(snap: Snapshot) -> Decision:
    coins = snap.get("coins") or {}
    symbols = list(coins.keys()) if isinstance(coins, dict) else []
    symbol = symbols[0] if symbols else "BTC"
    return {
        "symbol": symbol,
        "action": "FLAT",
        "positionSizePercent": 0,
        "reason": "queue readiness heartbeat",
    }


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
    # QUEUE readiness announcements — log once on each transition, not per cycle.
    announced_queue_waiting = False
    announced_queue_ready = False

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
            # QUEUE phase: the season is gated until enough agents heartbeat,
            # and submitting a decision is the heartbeat. The loop already
            # submits below — surface why "joined" isn't "ready" yet, and
            # confirm once the heartbeat registers.
            readiness = snap.get("readiness") or {}
            if readiness.get("phase") == "QUEUE":
                if readiness.get("agentReady"):
                    if not announced_queue_ready:
                        print(
                            f"[queue] Readiness heartbeat registered — "
                            f"{readiness.get('readyCount')}/{readiness.get('minAgents')} agents ready. "
                            f"Season launches automatically at quorum."
                        )
                        announced_queue_ready = True
                elif not announced_queue_waiting:
                    print(
                        f"[queue] Season gated — submitting a decision to register your "
                        f"readiness heartbeat ({readiness.get('readyCount')}/{readiness.get('minAgents')} ready). "
                        f"QUEUE submissions are accepted but not executed until LIVE."
                    )
                    announced_queue_waiting = True

            next_cycle = int(snap["server"]["acceptingDecisionsForCycle"])
            if next_cycle > last_submitted:
                decisions: List[Decision] = list(decide(snap) or [])
                if needs_queue_heartbeat(snap, decisions):
                    decisions = [build_queue_heartbeat_decision(snap)]
                if len(decisions) > 0:
                    result = submit(
                        cfg.base_url, cfg.agent_id, token,
                        decisions=list(decisions),
                        model=cfg.model or "runtime-queue-heartbeat",
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
            if e.status == 401:
                # Cached bearer is stale (e.g. backend redeploy re-rolled
                # the signing secret). Drop it so the next iteration's
                # tokens.get() re-authenticates with the apiKey.
                tokens.invalidate()
                continue
            if e.status == 429:
                if _sleep(min(cfg.poll_interval_ms * 2, 30_000) / 1000.0):
                    return
                continue
        except Exception as e:
            if on_error:
                on_error(e)

        if _sleep(cfg.poll_interval_ms / 1000.0):
            return
