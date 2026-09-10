from __future__ import annotations

from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

from .model import SourceSnapshot
from .object_identity import resource_id, resource_reference_id

if TYPE_CHECKING:
    from .classifier import Operation
    from .sql_parser import ParsedStatement


class RemovedComponentError(ValueError):
    """Raised when a retired technology would be reintroduced by a decision."""


def assert_removed_component_action(object_id: str, action: str) -> None:
    if object_id.startswith("removed_component:") and action == "migrate":
        raise RemovedComponentError(f"retired component {object_id} cannot migrate")


def _literal_string(value: dict[str, Any] | None) -> str | None:
    if not isinstance(value, dict):
        return None
    candidate = value.get("A_Const", {}).get("sval", {}).get("sval")
    return candidate if isinstance(candidate, str) and candidate else None


def _operation(
    statement: "ParsedStatement",
    *,
    action: str,
    object_id: str,
    object_type: str,
    ordinal: int = 0,
    classification: str = "object_operation",
) -> "Operation":
    from .classifier import Operation

    return Operation(
        classification=classification,
        action=action,
        object_id=object_id,
        object_type=object_type,
        node_type=statement.node_type,
        source_path=statement.source_path,
        start_byte=statement.start_byte,
        end_byte=statement.end_byte,
        statement_sha256=statement.statement_sha256,
        ordinal=ordinal,
    )


def _bucket_operations(statement: "ParsedStatement", node: dict[str, Any]) -> tuple["Operation", ...] | None:
    relation = node.get("relation", {})
    if relation.get("schemaname") != "storage" or relation.get("relname") != "buckets":
        return None
    columns = [item.get("ResTarget", {}).get("name") for item in node.get("cols", [])]
    if "id" not in columns:
        return (
            _operation(
                statement,
                action="review_required",
                object_id=resource_reference_id("storage.buckets", statement.statement_sha256),
                object_type="resource_reference",
                classification="data_operation",
            ),
        )
    id_index = columns.index("id")
    rows = node.get("selectStmt", {}).get("SelectStmt", {}).get("valuesLists")
    if not isinstance(rows, list):
        return (
            _operation(
                statement,
                action="review_required",
                object_id=resource_reference_id("storage.buckets", statement.statement_sha256),
                object_type="resource_reference",
                classification="data_operation",
            ),
        )
    operations: list[Operation] = []
    for ordinal, row in enumerate(rows):
        items = row.get("List", {}).get("items", [])
        bucket = _literal_string(items[id_index] if id_index < len(items) else None)
        if bucket is None:
            return (
                _operation(
                    statement,
                    action="review_required",
                    object_id=resource_reference_id("storage.buckets", statement.statement_sha256),
                    object_type="resource_reference",
                    classification="data_operation",
                ),
            )
        operations.append(
            _operation(
                statement,
                action="create",
                object_id=resource_id("bucket", bucket),
                object_type="bucket",
                ordinal=ordinal,
            )
        )
    return tuple(operations)


def _job_operations(statement: "ParsedStatement", node: dict[str, Any]) -> tuple["Operation", ...] | None:
    targets = node.get("targetList")
    if not isinstance(targets, list) or len(targets) != 1:
        return None
    call = targets[0].get("ResTarget", {}).get("val", {}).get("FuncCall", {})
    function_names = [
        item.get("String", {}).get("sval") for item in call.get("funcname", [])
    ]
    if function_names != ["cron", "schedule"]:
        return None
    arguments = call.get("args", [])
    name = _literal_string(arguments[0] if arguments else None)
    if name is None:
        return (
            _operation(
                statement,
                action="review_required",
                object_id=resource_reference_id("cron.schedule", statement.statement_sha256),
                object_type="resource_reference",
                classification="data_operation",
            ),
        )
    return (
        _operation(
            statement,
            action="create",
            object_id=f"job:{resource_id('mechanism', 'cron.schedule').split(':', 1)[1]}:{resource_id('name', name).split(':', 1)[1]}",
            object_type="job",
        ),
    )


def classify_resource_statement(statement: "ParsedStatement") -> tuple["Operation", ...] | None:
    node = statement.ast.get(statement.node_type, {})
    if statement.node_type == "InsertStmt":
        return _bucket_operations(statement, node)
    if statement.node_type == "SelectStmt":
        return _job_operations(statement, node)
    return None


def source_resource_operations(snapshot: SourceSnapshot) -> tuple["Operation", ...]:
    from .classifier import Operation

    operations: list[Operation] = []
    removed: dict[str, list] = {}
    for source in snapshot.files:
        if source.kind == "edge_function":
            name = PurePosixPath(source.path).name
            operations.append(
                Operation(
                    classification="object_operation",
                    action="create",
                    object_id=resource_id("edge_function", name),
                    object_type="edge_function",
                    node_type="EdgeFunctionDirectory",
                    source_path=source.path,
                    start_byte=0,
                    end_byte=source.size,
                    statement_sha256=source.sha256,
                )
            )
        elif source.kind == "removed_component":
            removed.setdefault(source.policy_id, []).append(source)
    for policy_id, sources in sorted(removed.items()):
        first = sorted(sources, key=lambda item: item.path)[0]
        operations.append(
            Operation(
                classification="object_operation",
                action="remove",
                object_id=resource_id("removed_component", policy_id),
                object_type="removed_component",
                node_type="RemovedComponentSource",
                source_path=first.path,
                start_byte=0,
                end_byte=sum(item.size for item in sources),
                statement_sha256=first.sha256,
            )
        )
    return tuple(sorted(operations, key=lambda item: item.object_id or ""))
