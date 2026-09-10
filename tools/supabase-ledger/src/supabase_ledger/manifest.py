from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .classifier import Operation


class ManifestCoverageError(ValueError):
    """Raised when the ledger would otherwise omit or ambiguously classify SQL."""


@dataclass(frozen=True)
class LogicalObject:
    object_id: str
    object_type: str
    lifecycle: str
    operations: tuple["Operation", ...]


def consolidate_operations(operations: tuple["Operation", ...]) -> tuple[LogicalObject, ...]:
    grouped: dict[str, list[Operation]] = {}
    for operation in operations:
        if operation.object_id is not None:
            grouped.setdefault(operation.object_id, []).append(operation)
    objects: list[LogicalObject] = []
    for object_id, collected in grouped.items():
        ordered = tuple(sorted(collected, key=lambda item: (item.source_path, item.start_byte, item.ordinal)))
        lifecycle = "unknown"
        for operation in ordered:
            if operation.action in {"create", "create_security_definer"}:
                lifecycle = "present"
            elif operation.action == "drop":
                lifecycle = "removed"
        objects.append(
            LogicalObject(
                object_id=object_id,
                object_type=ordered[0].object_type or "unknown",
                lifecycle=lifecycle,
                operations=ordered,
            )
        )
    return tuple(sorted(objects, key=lambda item: item.object_id))


def build_manifest(operations: tuple["Operation", ...]) -> dict[str, Any]:
    unclassified = sorted({item.node_type for item in operations if item.classification == "unclassified"})
    if unclassified:
        raise ManifestCoverageError(
            "unclassified SQL statement types: " + ", ".join(unclassified)
        )
    objects = consolidate_operations(operations)
    return {
        "format_version": 1,
        "operations": [asdict(item) for item in operations],
        "objects": [
            {
                "object_id": item.object_id,
                "object_type": item.object_type,
                "lifecycle": item.lifecycle,
                "operation_count": len(item.operations),
            }
            for item in objects
        ],
        "summary": {
            "operation_count": len(operations),
            "object_count": len(objects),
            "unclassified_count": 0,
        },
    }
