from __future__ import annotations

from collections import Counter
from typing import Any


def _cell(value: Any) -> str:
    rendered = "—" if value is None else str(value)
    return rendered.replace("\\", "\\\\").replace("|", "\\|").replace("`", "\\`")


def render_markdown(manifest: dict[str, Any], decisions: dict[str, Any]) -> str:
    objects = manifest.get("objects", [])
    rows = decisions.get("decisions", [])
    action_counts = Counter(row.get("action") for row in rows if isinstance(row, dict))
    review_counts = Counter(row.get("review_status") for row in rows if isinstance(row, dict))
    by_id = {
        row["object_id"]: row
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("object_id"), str)
    }

    lines = [
        "# Supabase object migration ledger",
        "",
        "> Generated view. `source-manifest.json` and `object-decisions.json` are authoritative.",
        "",
        "## Coverage",
        "",
        f"- Sources: {len(manifest.get('sources', []))}",
        f"- Operations: {manifest.get('summary', {}).get('operation_count', 0)}",
        f"- Objects: {manifest.get('summary', {}).get('object_count', len(objects))}",
        f"- Unclassified: {manifest.get('summary', {}).get('unclassified_count', 0)}",
        f"- Proposed: {review_counts.get('proposed', 0)}",
        f"- Approved: {review_counts.get('approved', 0)}",
        f"- Pending action: {action_counts.get('pending', 0)}",
        "",
        "## Object decisions",
        "",
        "| Object | Type | Lifecycle | Action | Target | Target name | Milestone | Review | Reason |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for item in sorted(objects, key=lambda candidate: candidate.get("object_id", "")):
        object_id = item.get("object_id")
        decision = by_id.get(object_id, {})
        lines.append(
            "| "
            + " | ".join(
                _cell(value)
                for value in (
                    object_id,
                    item.get("object_type"),
                    item.get("lifecycle"),
                    decision.get("action"),
                    decision.get("target_component"),
                    decision.get("target_name"),
                    decision.get("milestone"),
                    decision.get("review_status"),
                    decision.get("reason_code"),
                )
            )
            + " |"
        )
    return "\n".join(lines) + "\n"
