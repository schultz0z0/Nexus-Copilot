from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .manifest import ManifestCoverageError, build_manifest, consolidate_operations
from .object_identity import (
    extension_id,
    function_id,
    grant_id,
    nested_relation_id,
    policy_id,
    relation_id,
    schema_id,
    table_id,
    trigger_id,
)
from .sql_parser import ParsedStatement, parse_statements


@dataclass(frozen=True)
class Operation:
    classification: str
    action: str
    object_id: str | None
    object_type: str | None
    node_type: str
    source_path: str
    start_byte: int
    end_byte: int
    statement_sha256: str
    ordinal: int = 0


def _operation(
    statement: ParsedStatement,
    *,
    action: str,
    object_id: str | None,
    object_type: str | None,
    ordinal: int = 0,
    classification: str = "object_operation",
) -> Operation:
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


def _string_values(items: list[dict[str, Any]] | None) -> list[str]:
    values: list[str] = []
    for item in items or []:
        value = item.get("String", {}).get("sval") if isinstance(item, dict) else None
        if not isinstance(value, str) or not value:
            raise ManifestCoverageError("AST contains an invalid identifier")
        values.append(value)
    return values


def _range_parts(value: dict[str, Any]) -> list[str]:
    schema = value.get("schemaname")
    name = value.get("relname")
    if not isinstance(schema, str) or not isinstance(name, str):
        raise ManifestCoverageError("relation is not explicitly schema-qualified")
    return [schema, name]


def _type_name(value: dict[str, Any]) -> str:
    names = _string_values(value.get("names"))
    if not names:
        raise ManifestCoverageError("function argument type has no name")
    rendered = ".".join(names)
    if value.get("arrayBounds"):
        rendered += "[]"
    return rendered


def _relation_object_id(kind: str, relation: dict[str, Any]) -> str:
    schema, name = _range_parts(relation)
    return relation_id(kind, schema, name, parsed=True)


def _classify_create_table(statement: ParsedStatement, node: dict[str, Any]) -> tuple[Operation, ...]:
    schema, table = _range_parts(node.get("relation", {}))
    operations = [
        _operation(
            statement,
            action="create",
            object_id=table_id([schema, table], parsed=True),
            object_type="table",
        )
    ]
    ordinal = 1
    for raw_element in node.get("tableElts", []):
        if "ColumnDef" in raw_element:
            column = raw_element["ColumnDef"].get("colname")
            if not isinstance(column, str):
                raise ManifestCoverageError("table column has no name")
            operations.append(
                _operation(
                    statement,
                    action="create",
                    object_id=nested_relation_id("column", schema, table, column, parsed=True),
                    object_type="column",
                    ordinal=ordinal,
                )
            )
        elif "Constraint" in raw_element:
            constraint = raw_element["Constraint"].get("conname")
            if not isinstance(constraint, str):
                raise ManifestCoverageError("table constraint has no explicit name")
            operations.append(
                _operation(
                    statement,
                    action="create",
                    object_id=nested_relation_id("constraint", schema, table, constraint, parsed=True),
                    object_type="constraint",
                    ordinal=ordinal,
                )
            )
        else:
            raise ManifestCoverageError("unsupported CREATE TABLE element")
        ordinal += 1
    return tuple(operations)


def _classify_alter_table(statement: ParsedStatement, node: dict[str, Any]) -> tuple[Operation, ...]:
    schema, table = _range_parts(node.get("relation", {}))
    table_object = table_id([schema, table], parsed=True)
    operations: list[Operation] = []
    for ordinal, raw_command in enumerate(node.get("cmds", [])):
        command = raw_command.get("AlterTableCmd", {})
        subtype = command.get("subtype")
        if subtype == "AT_AddColumn" and isinstance(command.get("def"), dict):
            column = command["def"].get("ColumnDef", {}).get("colname")
            if not isinstance(column, str):
                raise ManifestCoverageError("ALTER TABLE column has no name")
            operations.append(
                _operation(
                    statement,
                    action="create",
                    object_id=nested_relation_id("column", schema, table, column, parsed=True),
                    object_type="column",
                    ordinal=ordinal,
                )
            )
        elif subtype == "AT_EnableRowSecurity":
            operations.append(_operation(statement, action="enable_rls", object_id=table_object, object_type="table", ordinal=ordinal))
        elif subtype == "AT_ForceRowSecurity":
            operations.append(_operation(statement, action="force_rls", object_id=table_object, object_type="table", ordinal=ordinal))
        elif subtype == "AT_DisableRowSecurity":
            operations.append(_operation(statement, action="disable_rls", object_id=table_object, object_type="table", ordinal=ordinal))
        elif subtype == "AT_NoForceRowSecurity":
            operations.append(_operation(statement, action="no_force_rls", object_id=table_object, object_type="table", ordinal=ordinal))
        elif subtype == "AT_ChangeOwner":
            operations.append(_operation(statement, action="owner", object_id=table_object, object_type="table", ordinal=ordinal))
        else:
            operations.append(
                _operation(
                    statement,
                    action=f"unclassified:{subtype or 'unknown'}",
                    object_id=None,
                    object_type=None,
                    ordinal=ordinal,
                    classification="unclassified",
                )
            )
    return tuple(operations) or (
        _operation(statement, action="unclassified:empty_alter", object_id=None, object_type=None, classification="unclassified"),
    )


def _classify_function(statement: ParsedStatement, node: dict[str, Any]) -> tuple[Operation, ...]:
    names = _string_values(node.get("funcname"))
    if len(names) != 2:
        raise ManifestCoverageError("function is not explicitly schema-qualified")
    argument_types: list[str] = []
    for item in node.get("parameters", []):
        parameter = item.get("FunctionParameter", {})
        if parameter.get("mode") not in {None, "FUNC_PARAM_OUT", "FUNC_PARAM_TABLE"}:
            argument_types.append(_type_name(parameter.get("argType", {})))
        elif parameter.get("mode") is None:
            argument_types.append(_type_name(parameter.get("argType", {})))
    security_definer = any(
        option.get("DefElem", {}).get("defname") == "security"
        and option.get("DefElem", {}).get("arg", {}).get("Boolean", {}).get("boolval") is True
        for option in node.get("options", [])
    )
    return (
        _operation(
            statement,
            action="create_security_definer" if security_definer else "create",
            object_id=function_id(names[0], names[1], argument_types, parsed=True),
            object_type="function",
        ),
    )


def _classify_grant(statement: ParsedStatement, node: dict[str, Any]) -> tuple[Operation, ...]:
    object_type = str(node.get("objtype", "")).removeprefix("OBJECT_").lower()
    if object_type != "table":
        return (_operation(statement, action="unclassified:grant_target", object_id=None, object_type=None, classification="unclassified"),)
    privileges = [item.get("AccessPriv", {}).get("priv_name") or "all" for item in node.get("privileges", [])] or ["all"]
    action = "grant" if node.get("is_grant") is True else "revoke"
    operations: list[Operation] = []
    ordinal = 0
    for raw_object in node.get("objects", []):
        relation = raw_object.get("RangeVar", {})
        target_id = _relation_object_id("table", relation)
        for raw_grantee in node.get("grantees", []):
            role = raw_grantee.get("RoleSpec", {}).get("rolename")
            if not isinstance(role, str):
                role = "public"
            identity = grant_id(target_id, role, privileges)
            operations.append(_operation(statement, action=action, object_id=identity, object_type="grant", ordinal=ordinal))
            ordinal += 1
    return tuple(operations)


def classify_statement(statement: ParsedStatement) -> tuple[Operation, ...]:
    node = statement.ast.get(statement.node_type, {})
    if statement.node_type in {"InsertStmt", "SelectStmt"}:
        from .resources import classify_resource_statement

        resource_operations = classify_resource_statement(statement)
        if resource_operations is not None:
            return resource_operations
    if statement.node_type == "CreateSchemaStmt":
        return (_operation(statement, action="create", object_id=schema_id(node["schemaname"], parsed=True), object_type="schema"),)
    if statement.node_type == "CreateExtensionStmt":
        return (_operation(statement, action="create", object_id=extension_id(node["extname"], parsed=True), object_type="extension"),)
    if statement.node_type == "CreateEnumStmt":
        names = _string_values(node.get("typeName"))
        return (_operation(statement, action="create", object_id=relation_id("type", names[0], names[1], parsed=True), object_type="type"),)
    if statement.node_type == "CreateSeqStmt":
        return (_operation(statement, action="create", object_id=_relation_object_id("sequence", node["sequence"]), object_type="sequence"),)
    if statement.node_type == "CreateStmt":
        return _classify_create_table(statement, node)
    if statement.node_type == "AlterTableStmt":
        return _classify_alter_table(statement, node)
    if statement.node_type == "IndexStmt":
        relation = node.get("relation", {})
        schema, _ = _range_parts(relation)
        return (_operation(statement, action="create", object_id=relation_id("index", schema, node["idxname"], parsed=True), object_type="index"),)
    if statement.node_type == "ViewStmt":
        return (_operation(statement, action="create", object_id=_relation_object_id("view", node["view"]), object_type="view"),)
    if statement.node_type == "CreateFunctionStmt":
        return _classify_function(statement, node)
    if statement.node_type == "CreateTrigStmt":
        schema, table = _range_parts(node.get("relation", {}))
        return (_operation(statement, action="create", object_id=trigger_id(schema, table, node["trigname"], parsed=True), object_type="trigger"),)
    if statement.node_type == "CreatePolicyStmt":
        schema, table = _range_parts(node.get("table", {}))
        return (_operation(statement, action="create", object_id=policy_id(schema, table, node["policy_name"], parsed=True), object_type="policy"),)
    if statement.node_type == "GrantStmt":
        return _classify_grant(statement, node)
    if statement.node_type == "CommentStmt":
        if node.get("objtype") == "OBJECT_TABLE":
            names = _string_values(node.get("object", {}).get("List", {}).get("items"))
            return (_operation(statement, action="comment", object_id=table_id(names, parsed=True), object_type="table"),)
    if statement.node_type == "DropStmt":
        kind = str(node.get("removeType", "")).removeprefix("OBJECT_").lower()
        operations = []
        for ordinal, raw_object in enumerate(node.get("objects", [])):
            names = _string_values(raw_object.get("List", {}).get("items"))
            operations.append(_operation(statement, action="drop", object_id=relation_id(kind, names[0], names[1], parsed=True), object_type=kind, ordinal=ordinal))
        return tuple(operations)
    return (
        _operation(
            statement,
            action=f"unclassified:{statement.node_type}",
            object_id=None,
            object_type=None,
            classification="unclassified",
        ),
    )


def classify_sql(sql: str, source_path: str) -> tuple[Operation, ...]:
    operations: list[Operation] = []
    for statement in parse_statements(sql, source_path):
        operations.extend(classify_statement(statement))
    return tuple(operations)


__all__ = [
    "ManifestCoverageError",
    "Operation",
    "build_manifest",
    "classify_sql",
    "classify_statement",
    "consolidate_operations",
]
