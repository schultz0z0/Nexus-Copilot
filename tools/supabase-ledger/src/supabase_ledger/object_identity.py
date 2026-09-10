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


def _identifier(value: str, *, parsed: bool) -> str:
    return normalize_identifier(value, quoted=parsed)


def qualified_id(kind: str, parts: Sequence[str], *, parsed: bool = False) -> str:
    if len(parts) != 2:
        raise ObjectIdentityError(f"{kind} identity must be schema-qualified")
    return f"{kind}:{_identifier(parts[0], parsed=parsed)}.{_identifier(parts[1], parsed=parsed)}"


def table_id(parts: Sequence[str], *, parsed: bool = False) -> str:
    return qualified_id("table", parts, parsed=parsed)


def schema_id(name: str, *, parsed: bool = False) -> str:
    return f"schema:{_identifier(name, parsed=parsed)}"


def extension_id(name: str, *, parsed: bool = False) -> str:
    return f"extension:{_identifier(name, parsed=parsed)}"


def relation_id(kind: str, schema: str, name: str, *, parsed: bool = False) -> str:
    return qualified_id(kind, [schema, name], parsed=parsed)


def nested_relation_id(
    kind: str,
    schema: str,
    table: str,
    name: str,
    *,
    parsed: bool = False,
) -> str:
    return (
        f"{kind}:{_identifier(schema, parsed=parsed)}."
        f"{_identifier(table, parsed=parsed)}.{_identifier(name, parsed=parsed)}"
    )


def _canonical_type(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ObjectIdentityError("function argument types must be non-empty strings")
    return _encode(re.sub(r"\s+", " ", value.strip()).lower())


def function_id(
    schema: str,
    name: str,
    argument_types: Sequence[str],
    *,
    parsed: bool = False,
) -> str:
    signature = ",".join(_canonical_type(item) for item in argument_types)
    return (
        f"function:{_identifier(schema, parsed=parsed)}."
        f"{_identifier(name, parsed=parsed)}({signature})"
    )


def policy_id(schema: str, table: str, name: str, *, parsed: bool = False) -> str:
    return (
        f"policy:{_identifier(schema, parsed=parsed)}.{_identifier(table, parsed=parsed)}."
        f"{normalize_identifier(name, quoted=True)}"
    )


def trigger_id(schema: str, table: str, name: str, *, parsed: bool = False) -> str:
    return (
        f"trigger:{_identifier(schema, parsed=parsed)}.{_identifier(table, parsed=parsed)}."
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
