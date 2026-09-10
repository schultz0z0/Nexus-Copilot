from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from urllib.parse import quote


class ObjectIdentityError(ValueError):
    """Raised when an object cannot receive an unambiguous stable identity."""


def _encode(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise ObjectIdentityError("object identity components must be non-empty strings")
    # RFC 3986 always treats a dot as unreserved, but dots are structural
    # separators in ledger IDs. Escape them explicitly to avoid collisions with
    # quoted PostgreSQL identifiers that contain literal dots.
    return quote(value, safe="_-$").replace(".", "%2E")


def normalize_identifier(value: str, *, quoted: bool = False) -> str:
    normalized = value if quoted else value.lower()
    return _encode(normalized)


def _qualified(kind: str, parts: Sequence[str]) -> str:
    if len(parts) != 2:
        raise ObjectIdentityError(f"{kind} identity must be schema-qualified")
    return f"{kind}:{normalize_identifier(parts[0])}.{normalize_identifier(parts[1])}"


def table_id(parts: Sequence[str]) -> str:
    return _qualified("table", parts)


def _canonical_type(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ObjectIdentityError("function argument types must be non-empty strings")
    return _encode(re.sub(r"\s+", " ", value.strip()).lower())


def function_id(schema: str, name: str, argument_types: Sequence[str]) -> str:
    signature = ",".join(_canonical_type(item) for item in argument_types)
    return (
        f"function:{normalize_identifier(schema)}."
        f"{normalize_identifier(name)}({signature})"
    )


def policy_id(schema: str, table: str, name: str) -> str:
    return (
        f"policy:{normalize_identifier(schema)}.{normalize_identifier(table)}."
        f"{normalize_identifier(name, quoted=True)}"
    )


def trigger_id(schema: str, table: str, name: str) -> str:
    return (
        f"trigger:{normalize_identifier(schema)}.{normalize_identifier(table)}."
        f"{normalize_identifier(name, quoted=True)}"
    )


def grant_id(object_id: str, role: str, privileges: Iterable[str]) -> str:
    normalized_privileges = sorted(
        {item.strip().lower() for item in privileges if isinstance(item, str) and item.strip()}
    )
    if not normalized_privileges:
        raise ObjectIdentityError("grant identity requires at least one privilege")
    return (
        f"grant:{_encode(object_id)}:{normalize_identifier(role)}:"
        f"{_encode(','.join(normalized_privileges))}"
    )
