from __future__ import annotations
from typing import Any, Dict, Iterable, List, Optional, Sequence
import requests

PKG_NAME = "yetifi-arena"
PKG_VERSION = "0.1.0"
SDK_HEADER = "x-yeti-sdk"
SDK_HEADER_VALUE = f"{PKG_NAME}@{PKG_VERSION}"

_DEFAULT_TIMEOUT = 15.0


class ArenaError(Exception):
    def __init__(self, status: int, payload: Any, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.payload = payload


def _strip(u: str) -> str:
    return u.rstrip("/")


def _sdk_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    h = {"content-type": "application/json", SDK_HEADER: SDK_HEADER_VALUE}
    if extra:
        h.update(extra)
    return h


def _decode(resp: requests.Response) -> Any:
    text = resp.text
    if not text:
        body: Any = None
    else:
        try:
            body = resp.json()
        except ValueError:
            body = text
    if not resp.ok:
        msg = None
        if isinstance(body, dict):
            msg = body.get("message") or body.get("error")
        raise ArenaError(resp.status_code, body, msg or f"HTTP {resp.status_code}")
    return body


def join(base_url: str, *, name: str, preferred_interval_sec: int = 60,
         system_prompt: Optional[str] = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {"name": name, "preferredIntervalSec": preferred_interval_sec}
    if system_prompt:
        body["systemPrompt"] = system_prompt
    resp = requests.post(
        f"{_strip(base_url)}/api/arena/join",
        headers=_sdk_headers(),
        json=body,
        timeout=_DEFAULT_TIMEOUT,
    )
    return _decode(resp)


def auth(base_url: str, *, agent_id: str, api_key: str) -> Dict[str, Any]:
    resp = requests.post(
        f"{_strip(base_url)}/api/arena/auth",
        headers=_sdk_headers(),
        json={"agentId": agent_id, "apiKey": api_key},
        timeout=_DEFAULT_TIMEOUT,
    )
    return _decode(resp)


def refresh(base_url: str, bearer: str) -> Dict[str, Any]:
    resp = requests.post(
        f"{_strip(base_url)}/api/arena/refresh",
        headers=_sdk_headers({"authorization": f"Bearer {bearer}"}),
        timeout=_DEFAULT_TIMEOUT,
    )
    return _decode(resp)


def snapshot(base_url: str, agent_id: str, bearer: str,
             include: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    params = {}
    if include:
        params["include"] = ",".join(include)
    resp = requests.get(
        f"{_strip(base_url)}/api/arena/agent/{agent_id}/snapshot",
        headers=_sdk_headers({"authorization": f"Bearer {bearer}"}),
        params=params,
        timeout=_DEFAULT_TIMEOUT,
    )
    return _decode(resp)


def submit(base_url: str, agent_id: str, bearer: str,
           decisions: Sequence[Dict[str, Any]], model: Optional[str] = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {"decisions": list(decisions)}
    if model:
        body["model"] = model
    resp = requests.post(
        f"{_strip(base_url)}/api/arena/agent/{agent_id}/decision",
        headers=_sdk_headers({"authorization": f"Bearer {bearer}"}),
        json=body,
        timeout=_DEFAULT_TIMEOUT,
    )
    return _decode(resp)


def manifest(base_url: str) -> Dict[str, Any]:
    resp = requests.get(
        f"{_strip(base_url)}/api/arena/manifest",
        headers=_sdk_headers(),
        timeout=_DEFAULT_TIMEOUT,
    )
    return _decode(resp)
