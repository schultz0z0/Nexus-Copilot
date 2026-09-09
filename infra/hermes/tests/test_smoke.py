"""Dependency-free helpers for validating the live Hermes API contract."""

from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


REQUIRED_RUN_FEATURES = (
    "run_submission",
    "run_status",
    "run_events_sse",
    "run_stop",
    "run_approval_response",
)


def _request(
    base_url: str,
    path: str,
    *,
    api_key: str | None = None,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body).encode("utf-8")

    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=payload,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=10) as response:
            response_body = response.read()
            return response.status, json.loads(response_body or b"{}")
    except HTTPError as error:
        response_body = error.read()
        try:
            parsed = json.loads(response_body or b"{}")
        except json.JSONDecodeError:
            parsed = {}
        return error.code, parsed


def _assert_auth_rejected(base_url: str, path: str, *, method: str = "GET") -> None:
    body = {} if method == "POST" else None
    status, _ = _request(base_url, path, method=method, body=body)
    if status not in (401, 403):
        raise AssertionError(
            f"{method} {path} without bearer auth returned HTTP {status}; expected 401 or 403"
        )


def assert_runs_contract(base_url: str, api_key: str) -> dict[str, Any]:
    """Assert auth and Runs capabilities without invoking a model provider."""

    _assert_auth_rejected(base_url, "/v1/capabilities")
    _assert_auth_rejected(base_url, "/v1/runs", method="POST")

    status, capabilities = _request(
        base_url,
        "/v1/capabilities",
        api_key=api_key,
    )
    if status != 200:
        raise AssertionError(f"authenticated capabilities returned HTTP {status}")
    if capabilities.get("auth") != {"type": "bearer", "required": True}:
        raise AssertionError("capabilities must declare required bearer authentication")

    missing = [
        feature
        for feature in REQUIRED_RUN_FEATURES
        if capabilities.get("features", {}).get(feature) is not True
    ]
    if missing:
        raise AssertionError(f"missing required Runs capabilities: {', '.join(missing)}")
    return capabilities
