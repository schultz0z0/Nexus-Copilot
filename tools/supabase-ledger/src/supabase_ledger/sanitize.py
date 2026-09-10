from __future__ import annotations

import re
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any


class ArtifactSafetyError(ValueError):
    """Raised when generated metadata resembles a secret or absolute path."""


_SECRET_PATTERNS = (
    re.compile(r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)://[^\s]+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bgh[opusr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~-]{16,}\b"),
)
_WINDOWS_ABSOLUTE = re.compile(r"^[A-Za-z]:[\\/]")


def _unsafe_string(value: str) -> str | None:
    if _WINDOWS_ABSOLUTE.match(value) or value.startswith("\\\\"):
        return "absolute Windows path"
    if PurePosixPath(value).is_absolute() or PureWindowsPath(value).is_absolute():
        return "absolute path"
    if value.lower().startswith("file://"):
        return "file URI"
    if any(pattern.search(value) for pattern in _SECRET_PATTERNS):
        return "secret-shaped value"
    return None


def assert_safe_artifact(value: Any, *, location: str = "$") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            assert_safe_artifact(item, location=f"{location}.{key}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            assert_safe_artifact(item, location=f"{location}[{index}]")
        return
    if isinstance(value, str):
        reason = _unsafe_string(value)
        if reason is not None:
            raise ArtifactSafetyError(f"{reason} rejected at {location}")


def sanitize_error(error: BaseException) -> str:
    """Return a bounded error label without echoing paths, SQL, or secrets."""
    name = type(error).__name__
    message = str(error).replace("\r", " ").replace("\n", " ")
    message = re.sub(r"[A-Za-z]:[\\/][^\s:]+", "<path>", message)
    message = re.sub(r"(?<![A-Za-z0-9])/(?:[^\s:]+/)*[^\s:]+", "<path>", message)
    for pattern in _SECRET_PATTERNS:
        message = pattern.sub("<redacted>", message)
    return f"{name}: {message[:300]}"
