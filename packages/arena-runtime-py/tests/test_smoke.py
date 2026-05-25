"""Smoke tests — pure-function checks, no network."""
import pytest

from yetifi_arena import SDK_HEADER, SDK_HEADER_VALUE, define_agent
from yetifi_arena.auth import _parse_iso_ms
from yetifi_arena.types import AgentConfig


def test_sdk_header_constant_is_x_yeti_sdk():
    assert SDK_HEADER == "x-yeti-sdk"


def test_sdk_header_value_is_pkg_at_version():
    assert SDK_HEADER_VALUE.startswith("yetifi-arena@")


def test_define_agent_defaults():
    a = define_agent(lambda snap: [])
    assert a.poll_interval_ms == 15_000
    assert a.include == ("analysis",)
    assert a.model is None


def test_define_agent_overrides():
    a = define_agent(lambda snap: [], poll_interval_ms=5_000, model="claude", include=["analysis", "history"])
    assert a.poll_interval_ms == 5_000
    assert a.model == "claude"
    assert a.include == ("analysis", "history")


@pytest.mark.parametrize("input_iso,expected_truthy", [
    ("2026-05-25T00:00:00Z", True),
    ("2026-05-25T00:00:00+00:00", True),
    ("not-a-date", False),
    (None, False),
    ("", False),
])
def test_iso_parsing(input_iso, expected_truthy):
    result = _parse_iso_ms(input_iso)
    assert bool(result) is expected_truthy


def test_agent_config_minimal():
    cfg = AgentConfig(base_url="http://x", agent_id="a", api_key="k")
    assert cfg.poll_interval_ms == 15_000
    assert cfg.include == ("analysis",)


def test_token_manager_invalidate_clears_cached_bearer():
    """Regression: stale bearer (e.g. after backend redeploy) must be
    droppable so the next get() re-auths via apiKey. Without
    invalidate(), the loop would spin on the dead token forever."""
    from yetifi_arena.auth import TokenManager
    tm = TokenManager("http://x", "a", "k", "fake-token", "2099-01-01T00:00:00Z")
    assert tm._token == "fake-token"
    assert tm._expires_at_ms is not None
    tm.invalidate()
    assert tm._token is None
    assert tm._expires_at_ms is None
