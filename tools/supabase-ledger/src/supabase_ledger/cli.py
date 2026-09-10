from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .decisions import generate_decision_document, verify_decisions
from .render import render_markdown
from .sanitize import assert_safe_artifact, sanitize_error


def _json_text(document: dict[str, Any]) -> str:
    return json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot load {label}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _build_source_manifest(source_root: Path, policy_path: Path) -> dict[str, Any]:
    # These imports intentionally stay scan-only. Offline verify/render therefore
    # require only the Python standard library and the checked-in package.
    from .classifier import build_manifest, classify_statement
    from .manifest import ManifestCoverageError
    from .resources import source_resource_operations
    from .source_policy import discover_sources, load_source_policy
    from .sql_parser import parse_statements

    policy = load_source_policy(policy_path)
    snapshot = discover_sources(source_root, policy)
    operations = []
    gaps: dict[tuple[str, str], dict[str, Any]] = {}

    def record_gap(source_path: str, start_byte: int, node_type: str, reason: str) -> None:
        key = (node_type, reason)
        if key not in gaps:
            gaps[key] = {
                "count": 0,
                "first": f"{source_path}@{start_byte}",
            }
        gaps[key]["count"] += 1
    for source in snapshot.files:
        if source.kind != "active_sql":
            continue
        sql_path = source_root / Path(source.path)
        try:
            sql = sql_path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            raise ValueError(f"cannot read active SQL source {source.path}") from error
        for statement in parse_statements(sql, source.path):
            try:
                classified = classify_statement(statement)
            except ManifestCoverageError as error:
                record_gap(
                    source.path,
                    statement.start_byte,
                    statement.node_type,
                    str(error),
                )
                continue
            except Exception as error:
                record_gap(
                    source.path,
                    statement.start_byte,
                    statement.node_type,
                    f"internal {type(error).__name__}",
                )
                continue
            unclassified = [
                item for item in classified if item.classification == "unclassified"
            ]
            if unclassified:
                detail = ",".join(sorted({item.action for item in unclassified}))
                record_gap(
                    source.path,
                    statement.start_byte,
                    statement.node_type,
                    detail,
                )
                continue
            operations.extend(classified)
    if gaps:
        limit = 25
        rendered = []
        for (node_type, reason), detail in sorted(gaps.items())[:limit]:
            count = detail["count"]
            label = "occurrence" if count == 1 else "occurrences"
            rendered.append(
                f"{node_type} ({reason}): {count} {label}, first {detail['first']}"
            )
        suffix = f"; and {len(gaps) - limit} more families" if len(gaps) > limit else ""
        raise ManifestCoverageError(
            "classification gaps: " + "; ".join(rendered) + suffix
        )
    operations.extend(source_resource_operations(snapshot))
    manifest = build_manifest(tuple(operations))
    manifest["source_policy_sha256"] = _file_sha256(policy_path)
    manifest["sources"] = [asdict(item) for item in snapshot.files]
    source_counts = Counter(item.kind for item in snapshot.files)
    manifest["summary"]["source_count"] = len(snapshot.files)
    manifest["summary"]["sources_by_kind"] = dict(sorted(source_counts.items()))
    return manifest


def run_scan(
    source_root: Path,
    policy_path: Path,
    manifest_path: Path,
    decisions_path: Path,
    report_path: Path,
) -> None:
    manifest = _build_source_manifest(source_root, policy_path)
    existing = _load_json(decisions_path, "existing decisions") if decisions_path.exists() else None
    decisions = generate_decision_document(manifest, existing=existing)
    verify_decisions(manifest, decisions)
    assert_safe_artifact(manifest)
    assert_safe_artifact(decisions)
    report = render_markdown(manifest, decisions)
    assert_safe_artifact(report)

    _atomic_write(manifest_path, _json_text(manifest))
    _atomic_write(decisions_path, _json_text(decisions))
    _atomic_write(report_path, report)


def run_verify(manifest_path: Path, decisions_path: Path, report_path: Path) -> None:
    manifest = _load_json(manifest_path, "source manifest")
    decisions = _load_json(decisions_path, "object decisions")
    assert_safe_artifact(manifest)
    assert_safe_artifact(decisions)
    verify_decisions(manifest, decisions)
    expected = render_markdown(manifest, decisions)
    try:
        actual = report_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError("cannot load ledger report") from error
    if actual != expected:
        raise ValueError("ledger report drift detected")
    assert_safe_artifact(actual)


def run_render(manifest_path: Path, decisions_path: Path, report_path: Path) -> None:
    manifest = _load_json(manifest_path, "source manifest")
    decisions = _load_json(decisions_path, "object decisions")
    assert_safe_artifact(manifest)
    assert_safe_artifact(decisions)
    verify_decisions(manifest, decisions)
    rendered = render_markdown(manifest, decisions)
    assert_safe_artifact(rendered)
    _atomic_write(report_path, rendered)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="supabase-ledger")
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan = subparsers.add_parser("scan")
    scan.add_argument("--source", type=Path, required=True)
    scan.add_argument("--policy", type=Path, required=True)
    scan.add_argument("--manifest", type=Path, required=True)
    scan.add_argument("--decisions", type=Path, required=True)
    scan.add_argument("--report", type=Path, required=True)

    for command in ("verify", "render"):
        child = subparsers.add_parser(command)
        child.add_argument("--manifest", type=Path, required=True)
        child.add_argument("--decisions", type=Path, required=True)
        child.add_argument("--report", type=Path, required=True)
    return parser


def main(arguments: list[str] | None = None) -> int:
    args = _parser().parse_args(arguments)
    try:
        if args.command == "scan":
            run_scan(args.source, args.policy, args.manifest, args.decisions, args.report)
        elif args.command == "verify":
            run_verify(args.manifest, args.decisions, args.report)
        else:
            run_render(args.manifest, args.decisions, args.report)
    except Exception as error:
        print(f"ledger error: {sanitize_error(error)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
