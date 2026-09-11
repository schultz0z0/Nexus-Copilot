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

    domain_stats: dict[str, dict[str, int]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        domain = row.get("target_component") or "unassigned"
        if domain not in domain_stats:
            domain_stats[domain] = {"total": 0, "approved": 0, "proposed": 0, "pending": 0}
        domain_stats[domain]["total"] += 1
        if row.get("review_status") == "approved":
            domain_stats[domain]["approved"] += 1
        else:
            domain_stats[domain]["proposed"] += 1
        if row.get("action") == "pending":
            domain_stats[domain]["pending"] += 1

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
        "## Domain summary",
        "",
        "| Domain / Component | Objects | Approved | Proposed | Pending |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]

    for domain in sorted(domain_stats.keys()):
        stats = domain_stats[domain]
        lines.append(
            f"| {_cell(domain)} | {stats['total']} | {stats['approved']} | {stats['proposed']} | {stats['pending']} |"
        )
    lines.append("")

    approved_rows = []
    proposed_rows = []

    for item in sorted(objects, key=lambda candidate: candidate.get("object_id", "")):
        object_id = item.get("object_id")
        decision = by_id.get(object_id, {})
        row_line = (
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
        if decision.get("review_status") == "approved":
            approved_rows.append(row_line)
        else:
            proposed_rows.append(row_line)

    lines.extend([
        "## Approved decisions",
        "",
    ])
    if approved_rows:
        lines.extend([
            "| Object | Type | Lifecycle | Action | Target | Target name | Milestone | Review | Reason |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            *approved_rows,
            "",
        ])
    else:
        lines.extend([
            "*(No approved decisions)*",
            "",
        ])

    lines.extend([
        "## Proposed decisions",
        "",
    ])
    if proposed_rows:
        lines.extend([
            "| Object | Type | Lifecycle | Action | Target | Target name | Milestone | Review | Reason |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            *proposed_rows,
        ])
    else:
        lines.extend([
            "*(No proposed decisions)*",
        ])

    return "\n".join(lines) + "\n"
