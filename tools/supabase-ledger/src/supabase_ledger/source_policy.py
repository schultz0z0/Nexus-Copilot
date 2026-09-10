from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any

from .model import MATCH_KINDS, SOURCE_KINDS, SourceFile, SourcePolicy, SourcePolicyEntry, SourceSnapshot


class SourcePolicyError(ValueError):
    """Raised when discovery cannot prove a safe, complete source set."""


def _require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SourcePolicyError(f"{label} must be an object")
    return value


def _require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SourcePolicyError(f"{label} must be a non-empty string")
    return value


def _validate_glob(pattern: str) -> str:
    candidate = PurePosixPath(pattern)
    if candidate.is_absolute() or ".." in candidate.parts or ":" in pattern:
        raise SourcePolicyError(f"unsafe glob: {pattern}")
    return candidate.as_posix()


def load_source_policy(path: Path) -> SourcePolicy:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SourcePolicyError(f"cannot load source policy: {error}") from error
    document = _require_mapping(raw, "source policy")
    if document.get("format_version") != 1:
        raise SourcePolicyError("unsupported source policy format_version")
    raw_sources = document.get("sources")
    if not isinstance(raw_sources, list) or not raw_sources:
        raise SourcePolicyError("source policy must contain sources")

    entries: list[SourcePolicyEntry] = []
    ids: set[str] = set()
    for index, raw_entry in enumerate(raw_sources):
        entry = _require_mapping(raw_entry, f"sources[{index}]")
        entry_id = _require_string(entry.get("id"), f"sources[{index}].id")
        if entry_id in ids:
            raise SourcePolicyError(f"duplicate source policy id: {entry_id}")
        ids.add(entry_id)
        kind = _require_string(entry.get("kind"), f"sources[{index}].kind")
        if kind not in SOURCE_KINDS:
            raise SourcePolicyError(f"unsupported source kind: {kind}")
        match = _require_string(entry.get("match"), f"sources[{index}].match")
        if match not in MATCH_KINDS:
            raise SourcePolicyError(f"unsupported source match: {match}")
        raw_globs = entry.get("globs")
        if not isinstance(raw_globs, list) or not raw_globs:
            raise SourcePolicyError(f"sources[{index}].globs must be a non-empty array")
        globs = tuple(_validate_glob(_require_string(item, "glob")) for item in raw_globs)
        expected_count = entry.get("expected_count")
        if not isinstance(expected_count, int) or isinstance(expected_count, bool) or expected_count < 0:
            raise SourcePolicyError(f"sources[{index}].expected_count must be a non-negative integer")
        critical = entry.get("critical")
        if not isinstance(critical, bool):
            raise SourcePolicyError(f"sources[{index}].critical must be boolean")
        entries.append(
            SourcePolicyEntry(
                id=entry_id,
                kind=kind,
                match=match,
                globs=globs,
                expected_count=expected_count,
                critical=critical,
            )
        )
    return SourcePolicy(format_version=1, sources=tuple(entries))


def _assert_within_root(path: Path, root: Path) -> Path:
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root):
        raise SourcePolicyError(f"source escapes source root: {path.name}")
    return resolved


def _hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _hash_directory(path: Path, root: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    files = sorted((item for item in path.rglob("*") if item.is_file()), key=lambda item: item.as_posix())
    for item in files:
        resolved = _assert_within_root(item, root)
        relative = item.relative_to(path).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        with resolved.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
        digest.update(b"\0")
    return digest.hexdigest(), size


def discover_sources(root: Path, policy: SourcePolicy) -> SourceSnapshot:
    try:
        resolved_root = root.resolve(strict=True)
    except OSError as error:
        raise SourcePolicyError("source root does not exist") from error
    if not resolved_root.is_dir():
        raise SourcePolicyError("source root must be a directory")

    discovered: list[SourceFile] = []
    owners: dict[str, str] = {}
    for entry in policy.sources:
        matches: dict[str, Path] = {}
        for pattern in entry.globs:
            for candidate in root.glob(pattern):
                if entry.match == "file" and not candidate.is_file():
                    continue
                if entry.match == "directory" and not candidate.is_dir():
                    continue
                _assert_within_root(candidate, resolved_root)
                relative = candidate.relative_to(root).as_posix()
                matches[relative] = candidate
        if len(matches) != entry.expected_count:
            raise SourcePolicyError(
                f"source policy {entry.id} expected {entry.expected_count} matches, found {len(matches)}"
            )
        for relative, candidate in sorted(matches.items()):
            if relative in owners:
                raise SourcePolicyError(
                    f"source {relative} matched by multiple policies: {owners[relative]}, {entry.id}"
                )
            owners[relative] = entry.id
            if entry.match == "file":
                sha256, size = _hash_file(candidate.resolve(strict=True))
            else:
                sha256, size = _hash_directory(candidate, resolved_root)
            discovered.append(
                SourceFile(
                    policy_id=entry.id,
                    kind=entry.kind,
                    path=relative,
                    sha256=sha256,
                    size=size,
                )
            )
    return SourceSnapshot(files=tuple(sorted(discovered, key=lambda item: item.path)))
