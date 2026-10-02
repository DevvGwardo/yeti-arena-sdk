"""HTTP errors name the method, path and server message (+ hint for agent endpoints)."""
import json

import pytest
import requests

from yetifi_arena.client import ArenaError, _decode, format_http_error


def _resp(status, method, url, body):
    r = requests.Response()
    r.status_code = status
    r._content = body if isinstance(body, bytes) else json.dumps(body).encode()
    r.request = requests.Request(method, url).prepare()
    return r


def test_agent_404_with_server_message_and_hint():
    with pytest.raises(ArenaError) as ei:
        _decode(_resp(404, "GET", "http://x/api/arena/agent/abc/snapshot?include=analysis", {"error": "Agent not found"}))
    e = ei.value
    assert e.status == 404
    assert str(e).startswith("HTTP 404 GET /api/arena/agent/abc/snapshot: Agent not found")
    assert "re-scaffold with a new name" in str(e)
    assert "include=" not in str(e)  # path only, no query string


def test_agent_401_gets_hint():
    assert "removed" in format_http_error(401, "POST", "/api/arena/agent/a/decision", {"message": "bad token"})


def test_no_body_message_and_no_hint_off_agent_paths():
    assert format_http_error(500, "POST", "/api/arena/join", None) == "HTTP 500 POST /api/arena/join"
    assert format_http_error(404, "GET", "/api/arena/styles", {"error": "nope"}) == "HTTP 404 GET /api/arena/styles: nope"


def test_non_string_and_long_messages_are_safe():
    assert format_http_error(400, "GET", "/p", {"error": {"x": 1}}) == "HTTP 400 GET /p"
    assert len(format_http_error(400, "GET", "/p", {"message": "m" * 5000})) < 260


def test_html_body_text_is_ignored():
    with pytest.raises(ArenaError) as ei:
        _decode(_resp(502, "GET", "http://x/api/arena/manifest", b"<html>bad gateway</html>"))
    assert str(ei.value) == "HTTP 502 GET /api/arena/manifest"
