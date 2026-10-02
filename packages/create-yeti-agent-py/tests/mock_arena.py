"""Minimal local mock arena (stdlib only) for full-cycle SDK testing.

Implements only what the Python runtime + scaffolder call in one cycle:
  GET  /api/arena/styles                       (404 -> scaffolder uses bundled styles)
  POST /api/arena/join
  POST /api/arena/auth, /api/arena/refresh
  GET  /api/arena/agent/<id>/snapshot
  POST /api/arena/agent/<id>/decision
Every request is appended to ``MockArena.requests``. After each accepted
decision the server advances ``acceptingDecisionsForCycle`` so the loop runs
another cycle. Never talks to the network; binds 127.0.0.1 only.

Standalone:  python mock_arena.py [port]
"""
from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional

VALID_ACTIONS = {"LONG", "SHORT", "FLAT"}
AGENT_ID = "mock-agent-1"
API_KEY = "mock-api-key"
TOKEN = "mock-bearer-token"


def _coin(trend: str, ch15: float, ch1h: float, vol: float) -> Dict[str, Any]:
    return {
        "price": 100.0,
        "analysis": {"trend": trend, "priceChange15m": ch15, "priceChange1h": ch1h, "volatility": vol},
    }


class MockArena:
    def __init__(self, port: int = 0) -> None:
        self.requests: List[Dict[str, Any]] = []
        self.decisions: List[Dict[str, Any]] = []
        self.cycle = 5
        self.agent_exists = True
        arena = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a: Any) -> None:  # silence
                pass

            def _send(self, status: int, body: Any) -> None:
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _body(self) -> Any:
                n = int(self.headers.get("content-length") or 0)
                raw = self.rfile.read(n) if n else b""
                return json.loads(raw) if raw else None

            def _handle(self, method: str) -> None:
                path = self.path.split("?")[0]
                body = self._body() if method == "POST" else None
                with arena._lock:
                    arena.requests.append({"method": method, "path": path, "body": body,
                                           "auth": self.headers.get("authorization")})
                    self._route(method, path, body)

            def _route(self, method: str, path: str, body: Any) -> None:
                exp = {"token": TOKEN, "expiresAt": "2099-01-01T00:00:00Z"}
                if method == "GET" and path == "/api/arena/styles":
                    return self._send(404, {"error": "not mocked"})
                if method == "POST" and path == "/api/arena/join":
                    return self._send(200, {
                        "agentId": AGENT_ID, "apiKey": API_KEY, "tier": "free",
                        "portfolioInitialValue": 10000, "createdAt": "2026-01-01T00:00:00Z",
                        "preferredIntervalSec": 60,
                    })
                if method == "POST" and path in ("/api/arena/auth", "/api/arena/refresh"):
                    return self._send(200, exp)
                prefix = f"/api/arena/agent/{AGENT_ID}/"
                if path.startswith("/api/arena/agent/") and not (arena.agent_exists and path.startswith(prefix)):
                    return self._send(404, {"error": "Agent not found"})
                if method == "GET" and path == prefix + "snapshot":
                    return self._send(200, arena.snapshot())
                if method == "POST" and path == prefix + "decision":
                    ds = (body or {}).get("decisions")
                    ok = isinstance(ds, list) and 0 < len(ds) <= 3 and all(
                        isinstance(d, dict) and d.get("symbol") and d.get("action") in VALID_ACTIONS
                        and isinstance(d.get("positionSizePercent"), (int, float)) for d in ds)
                    if not ok:
                        return self._send(400, {"error": "invalid decisions"})
                    target = arena.cycle
                    arena.decisions.append({"targetCycle": target, "decisions": ds, "model": body.get("model")})
                    arena.cycle += 1
                    return self._send(200, {"accepted": True, "agentId": AGENT_ID, "targetCycle": target})
                self._send(404, {"error": "no such route"})

            def do_GET(self) -> None: self._handle("GET")
            def do_POST(self) -> None: self._handle("POST")

        self._lock = threading.Lock()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.port = self.httpd.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self._thread: Optional[threading.Thread] = None

    def snapshot(self) -> Dict[str, Any]:
        return {
            "server": {"acceptingDecisionsForCycle": self.cycle},
            "readiness": {"phase": "LIVE", "agentReady": True, "readyCount": 3, "minAgents": 3},
            "coins": {
                "BTC": _coin("STRONG_UP", 0.9, 1.5, 1.2),
                "ETH": _coin("DOWN", -0.7, -1.0, 1.8),
                "SOL": _coin("NEUTRAL", 0.1, 0.0, 2.0),
            },
        }

    def start(self) -> "MockArena":
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


if __name__ == "__main__":
    m = MockArena(int(sys.argv[1]) if len(sys.argv) > 1 else 0)
    print(f"mock arena on {m.url}", flush=True)
    m.httpd.serve_forever()
