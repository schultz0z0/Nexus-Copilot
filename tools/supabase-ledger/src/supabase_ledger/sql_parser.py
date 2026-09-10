from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

from pglast.parser import ParseError, parse_sql_json


class SqlParseError(ValueError):
    """A sanitized SQL parsing failure that never includes source text."""


@dataclass(frozen=True)
class ParsedStatement:
    source_path: str
    node_type: str
    start_byte: int
    end_byte: int
    statement_sha256: str
    ast: dict[str, Any]


def _validate_source_path(source_path: str) -> str:
    posix = PurePosixPath(source_path)
    windows = PureWindowsPath(source_path)
    if (
        not source_path
        or posix.is_absolute()
        or windows.is_absolute()
        or ".." in posix.parts
        or "\\" in source_path
    ):
        raise SqlParseError("SQL parser requires a safe relative source path")
    return posix.as_posix()


def _parse_error_position(error: ParseError) -> int | str:
    location = getattr(error, "location", None)
    if isinstance(location, int):
        return location
    for item in reversed(error.args):
        if isinstance(item, int):
            return item
    return "unknown"


def parse_statements(sql: str, source_path: str) -> tuple[ParsedStatement, ...]:
    safe_source = _validate_source_path(source_path)
    try:
        document = json.loads(parse_sql_json(sql))
    except ParseError as error:
        position = _parse_error_position(error)
        raise SqlParseError(f"SQL parse failed for {safe_source} at position {position}") from error
    except (TypeError, json.JSONDecodeError) as error:
        raise SqlParseError(f"SQL parser returned invalid AST for {safe_source} at position unknown") from error

    raw_statements = document.get("stmts") if isinstance(document, dict) else None
    if not isinstance(raw_statements, list):
        raise SqlParseError(f"SQL parser returned invalid AST for {safe_source} at position unknown")
    encoded = sql.encode("utf-8")
    parsed: list[ParsedStatement] = []
    for raw in raw_statements:
        if not isinstance(raw, dict) or not isinstance(raw.get("stmt"), dict):
            raise SqlParseError(f"SQL parser returned invalid statement for {safe_source} at position unknown")
        ast = raw["stmt"]
        if len(ast) != 1:
            raise SqlParseError(f"SQL parser returned ambiguous statement for {safe_source} at position unknown")
        node_type = next(iter(ast))
        start = raw.get("stmt_location", 0)
        length = raw.get("stmt_len", 0)
        if not isinstance(start, int) or not isinstance(length, int) or start < 0 or length < 0:
            raise SqlParseError(f"SQL parser returned invalid location for {safe_source} at position unknown")
        end = start + length if length else len(encoded)
        if end > len(encoded):
            raise SqlParseError(f"SQL parser returned invalid location for {safe_source} at position {start}")
        statement_hash = hashlib.sha256(encoded[start:end]).hexdigest()
        parsed.append(
            ParsedStatement(
                source_path=safe_source,
                node_type=node_type,
                start_byte=start,
                end_byte=end,
                statement_sha256=statement_hash,
                ast=ast,
            )
        )
    return tuple(parsed)
