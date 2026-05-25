from __future__ import annotations
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from .client import ArenaError, auth as do_auth, refresh as do_refresh

_REFRESH_LEAD_MS = 60_000


def _parse_iso_ms(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    # Tolerate trailing "Z" — server sends ISO-8601 UTC.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


class TokenManager:
    def __init__(self, base_url: str, agent_id: str, api_key: str,
                 initial_token: Optional[str] = None,
                 initial_expires_at: Optional[str] = None) -> None:
        self._base_url = base_url
        self._agent_id = agent_id
        self._api_key = api_key
        self._token = initial_token or None
        self._expires_at_ms = _parse_iso_ms(initial_expires_at)
        self._lock = threading.Lock()

    def get(self) -> str:
        with self._lock:
            now_ms = int(time.time() * 1000)
            if self._token and self._expires_at_ms and self._expires_at_ms - now_ms > _REFRESH_LEAD_MS:
                return self._token
            return self._acquire()

    def invalidate(self) -> None:
        """Drop the cached bearer so the next get() re-authenticates.

        Call this from the loop when /snapshot or /decision returns 401.
        The bearer expiry clock is server-secret-derived; a backend redeploy
        can invalidate a token that still looks fresh by clock, and only
        the next 401 surfaces that. Without invalidation the loop would
        spin on the stale bearer forever.
        """
        with self._lock:
            self._token = None
            self._expires_at_ms = None

    def _acquire(self) -> str:
        if self._token:
            try:
                r = do_refresh(self._base_url, self._token)
                self._token = r["token"]
                self._expires_at_ms = _parse_iso_ms(r.get("expiresAt"))
                return self._token  # type: ignore[return-value]
            except ArenaError as e:
                if e.status != 401:
                    raise
        fresh = do_auth(self._base_url, agent_id=self._agent_id, api_key=self._api_key)
        self._token = fresh["token"]
        self._expires_at_ms = _parse_iso_ms(fresh.get("expiresAt"))
        return self._token  # type: ignore[return-value]
