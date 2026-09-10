from __future__ import annotations

from dataclasses import dataclass


SOURCE_KINDS = frozenset(
    {"active_sql", "edge_function", "historical_only", "removed_component"}
)
MATCH_KINDS = frozenset({"file", "directory"})


@dataclass(frozen=True)
class SourcePolicyEntry:
    id: str
    kind: str
    match: str
    globs: tuple[str, ...]
    expected_count: int
    critical: bool


@dataclass(frozen=True)
class SourcePolicy:
    format_version: int
    sources: tuple[SourcePolicyEntry, ...]


@dataclass(frozen=True)
class SourceFile:
    policy_id: str
    kind: str
    path: str
    sha256: str
    size: int


@dataclass(frozen=True)
class SourceSnapshot:
    files: tuple[SourceFile, ...]

    @property
    def critical_source_count(self) -> int:
        return sum(1 for item in self.files if item.kind == "active_sql")
