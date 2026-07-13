"""QUEUE readiness heartbeat — pure helpers + mocked run_live."""
from __future__ import annotations
from unittest.mock import MagicMock, patch

import pytest

from yetifi_arena.loop import (
    build_queue_heartbeat_decision,
    needs_queue_heartbeat,
    run_live,
)
from yetifi_arena.types import AgentConfig, Decision


def _base_snap(**overrides):
    snap = {
        "agentId": "a1",
        "name": "bot",
        "tier": "free",
        "status": "ACTIVE",
        "preferredIntervalSec": 60,
        "server": {
            "currentCycle": 1,
            "acceptingDecisionsForCycle": 2,
            "cycleStartedAt": "2026-07-13T00:00:00Z",
            "cycleAgeMs": 100,
            "nextCycleAt": "2026-07-13T00:01:00Z",
            "timestamp": "2026-07-13T00:00:00Z",
        },
        "rateLimit": {"limit": 120, "used": 0, "remaining": 120},
        "coins": {"ETH": {"price": 3000}, "BTC": {"price": 100000}},
        "portfolio": {
            "cash": 10_000,
            "portfolioValue": 10_000,
            "unrealizedPnl": 0,
            "peakValue": 10_000,
            "currentDrawdownPercent": 0,
            "openTrades": {},
            "portfolioHistory": [],
        },
        "recentDecisions": [],
        "recentTrades": [],
        "readiness": {
            "phase": "QUEUE",
            "gated": True,
            "agentReady": False,
            "readyCount": 0,
            "minAgents": 3,
            "action": "submit a decision",
        },
    }
    snap.update(overrides)
    return snap


def test_needs_queue_heartbeat_true_when_queue_not_ready_empty():
    assert needs_queue_heartbeat(_base_snap(), []) is True


def test_needs_queue_heartbeat_false_when_live():
    snap = _base_snap(
        readiness={"phase": "LIVE", "gated": False, "agentReady": True, "action": "go"}
    )
    assert needs_queue_heartbeat(snap, []) is False


def test_needs_queue_heartbeat_false_when_real_decisions():
    real: list[Decision] = [
        {"symbol": "BTC", "action": "LONG", "positionSizePercent": 10, "reason": "edge"}
    ]
    assert needs_queue_heartbeat(_base_snap(), real) is False


def test_needs_queue_heartbeat_false_when_already_ready():
    snap = _base_snap(
        readiness={
            "phase": "QUEUE",
            "gated": True,
            "agentReady": True,
            "readyCount": 1,
            "minAgents": 3,
            "action": "ready",
        }
    )
    assert needs_queue_heartbeat(snap, []) is False


def test_build_queue_heartbeat_uses_first_coin():
    assert build_queue_heartbeat_decision(_base_snap()) == {
        "symbol": "ETH",
        "action": "FLAT",
        "positionSizePercent": 0,
        "reason": "queue readiness heartbeat",
    }


def test_build_queue_heartbeat_falls_back_to_btc():
    assert build_queue_heartbeat_decision(_base_snap(coins={})) == {
        "symbol": "BTC",
        "action": "FLAT",
        "positionSizePercent": 0,
        "reason": "queue readiness heartbeat",
    }


@pytest.fixture
def cfg():
    return AgentConfig(
        base_url="http://x",
        agent_id="a1",
        api_key="k",
        poll_interval_ms=1,
        bearer_token="tok",
        bearer_expires_at="2099-01-01T00:00:00Z",
    )


@patch("yetifi_arena.loop.submit")
@patch("yetifi_arena.loop.fetch_snapshot")
@patch("yetifi_arena.loop.TokenManager")
def test_run_live_queue_empty_submits_heartbeat(mock_tm, mock_snap, mock_submit, cfg):
    mock_tm.return_value.get.return_value = "tok"
    mock_snap.return_value = _base_snap()
    mock_submit.return_value = {"accepted": True, "targetCycle": 2, "replaced": False}

    run_live(cfg, lambda snap: [], max_cycles=1)

    mock_submit.assert_called_once()
    kwargs = mock_submit.call_args
    # submit(base, agent, token, decisions=..., model=...)
    assert kwargs.kwargs["decisions"] == [
        {
            "symbol": "ETH",
            "action": "FLAT",
            "positionSizePercent": 0,
            "reason": "queue readiness heartbeat",
        }
    ]
    assert kwargs.kwargs["model"] == "runtime-queue-heartbeat"


@patch("yetifi_arena.loop.submit")
@patch("yetifi_arena.loop.fetch_snapshot")
@patch("yetifi_arena.loop.TokenManager")
def test_run_live_live_empty_skips_submit(mock_tm, mock_snap, mock_submit, cfg):
    mock_tm.return_value.get.return_value = "tok"
    mock_snap.return_value = _base_snap(
        readiness={"phase": "LIVE", "gated": False, "agentReady": True, "action": "go"}
    )

    run_live(cfg, lambda snap: [], max_cycles=1)

    mock_submit.assert_not_called()


@patch("yetifi_arena.loop.submit")
@patch("yetifi_arena.loop.fetch_snapshot")
@patch("yetifi_arena.loop.TokenManager")
def test_run_live_queue_real_decisions_not_synthetic(mock_tm, mock_snap, mock_submit, cfg):
    mock_tm.return_value.get.return_value = "tok"
    mock_snap.return_value = _base_snap()
    mock_submit.return_value = {"accepted": True, "targetCycle": 2, "replaced": False}
    real = [{"symbol": "BTC", "action": "LONG", "positionSizePercent": 10, "reason": "edge"}]

    run_live(cfg, lambda snap: real, max_cycles=1)

    mock_submit.assert_called_once()
    assert mock_submit.call_args.kwargs["decisions"] == real
