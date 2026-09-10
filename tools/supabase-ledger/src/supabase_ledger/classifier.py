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
    resource_id,
    resource_reference_id,
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


def _node_name_parts(value: dict[str, Any]) -> list[str]:
    if "List" in value:
        return _string_values(value["List"].get("items"))
    if "String" in value:
        candidate = value["String"].get("sval")
        return [candidate] if isinstance(candidate, str) and candidate else []
    if "TypeName" in value:
        return _string_values(value["TypeName"].get("names"))
    if "ObjectWithArgs" in value:
        return _string_values(value["ObjectWithArgs"].get("objname"))
    return []


def _function_reference(value: dict[str, Any]) -> str:
    function = value.get("ObjectWithArgs", {})
    names = _string_values(function.get("objname"))
    if len(names) != 2:
        raise ManifestCoverageError("function reference is not schema-qualified")
    arguments = [
        _type_name(item.get("TypeName", {})) for item in function.get("objargs", [])
    ]
    return function_id(names[0], names[1], arguments, parsed=True)


def _reference_operation(
    statement: ParsedStatement,
    target: str,
    action: str,
    *,
    classification: str = "data_operation",
) -> Operation:
    return _operation(
        statement,
        action=action,
        object_id=resource_reference_id(target, statement.statement_sha256),
        object_type="resource_reference",
        classification=classification,
    )


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
    def append_constraint(constraint: dict[str, Any]) -> None:
        ordinal = len(operations)
        name = constraint.get("conname")
        if not isinstance(name, str):
            kind = str(constraint.get("contype", "constraint")).removeprefix("CONSTR_").lower()
            name = f"__anonymous_{kind}_{statement.statement_sha256[:12]}_{ordinal}"
        operations.append(
            _operation(
                statement,
                action="create",
                object_id=nested_relation_id(
                    "constraint", schema, table, name, parsed=True
                ),
                object_type="constraint",
                ordinal=ordinal,
            )
        )

    for raw_element in node.get("tableElts", []):
        if "ColumnDef" in raw_element:
            definition = raw_element["ColumnDef"]
            column = definition.get("colname")
            if not isinstance(column, str):
                raise ManifestCoverageError("table column has no name")
            operations.append(
                _operation(
                    statement,
                    action="create",
                    object_id=nested_relation_id("column", schema, table, column, parsed=True),
                    object_type="column",
                    ordinal=len(operations),
                )
            )
            for raw_constraint in definition.get("constraints", []):
                constraint = raw_constraint.get("Constraint", {})
                if not constraint:
                    raise ManifestCoverageError("unsupported column constraint")
                append_constraint(constraint)
        elif "Constraint" in raw_element:
            append_constraint(raw_element["Constraint"])
        else:
            raise ManifestCoverageError("unsupported CREATE TABLE element")
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
        elif subtype == "AT_AddConstraint" and isinstance(command.get("def"), dict):
            constraint = command["def"].get("Constraint", {})
            name = constraint.get("conname")
            if not isinstance(name, str):
                kind = str(constraint.get("contype", "constraint")).removeprefix("CONSTR_").lower()
                name = f"__anonymous_{kind}_{statement.statement_sha256[:12]}_{ordinal}"
            operations.append(
                _operation(
                    statement,
                    action="create",
                    object_id=nested_relation_id(
                        "constraint", schema, table, name, parsed=True
                    ),
                    object_type="constraint",
                    ordinal=ordinal,
                )
            )
        elif subtype in {
            "AT_AddIdentity",
            "AT_AlterColumnType",
            "AT_ColumnDefault",
            "AT_SetNotNull",
            "AT_DropNotNull",
        }:
            column = command.get("name")
            if not isinstance(column, str):
                raise ManifestCoverageError(f"{subtype} column has no name")
            if subtype == "AT_ColumnDefault":
                action = "set_default" if command.get("def") is not None else "drop_default"
            else:
                action = {
                    "AT_AddIdentity": "add_identity",
                    "AT_AlterColumnType": "alter_type",
                    "AT_SetNotNull": "set_not_null",
                    "AT_DropNotNull": "drop_not_null",
                }[subtype]
            operations.append(
                _operation(
                    statement,
                    action=action,
                    object_id=nested_relation_id(
                        "column", schema, table, column, parsed=True
                    ),
                    object_type="column",
                    ordinal=ordinal,
                )
            )
        elif subtype in {"AT_DropConstraint", "AT_ValidateConstraint"}:
            constraint = command.get("name")
            if not isinstance(constraint, str):
                raise ManifestCoverageError(f"{subtype} constraint has no name")
            operations.append(
                _operation(
                    statement,
                    action="drop" if subtype == "AT_DropConstraint" else "validate",
                    object_id=nested_relation_id(
                        "constraint", schema, table, constraint, parsed=True
                    ),
                    object_type="constraint",
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
    if object_type not in {"table", "sequence", "schema", "function"}:
        return (_operation(statement, action="unclassified:grant_target", object_id=None, object_type=None, classification="unclassified"),)
    privileges = [item.get("AccessPriv", {}).get("priv_name") or "all" for item in node.get("privileges", [])] or ["all"]
    action = "grant" if node.get("is_grant") is True else "revoke"
    operations: list[Operation] = []
    ordinal = 0
    for raw_object in node.get("objects", []):
        if node.get("targtype") == "ACL_TARGET_ALL_IN_SCHEMA":
            names = _node_name_parts(raw_object)
            if len(names) != 1:
                raise ManifestCoverageError("grant schema scope is ambiguous")
            target_id = resource_id("grant_scope", f"{object_type}.{names[0]}")
        elif object_type == "schema":
            names = _node_name_parts(raw_object)
            if len(names) != 1:
                raise ManifestCoverageError("grant schema target is ambiguous")
            target_id = schema_id(names[0], parsed=True)
        elif object_type == "function":
            target_id = _function_reference(raw_object)
        else:
            relation = raw_object.get("RangeVar", {})
            target_id = _relation_object_id(object_type, relation)
        for raw_grantee in node.get("grantees", []):
            role = raw_grantee.get("RoleSpec", {}).get("rolename")
            if not isinstance(role, str):
                role = "public"
            identity = grant_id(target_id, role, privileges)
            operations.append(_operation(statement, action=action, object_id=identity, object_type="grant", ordinal=ordinal))
            ordinal += 1
    return tuple(operations)


def _classify_owner(statement: ParsedStatement, node: dict[str, Any]) -> tuple[Operation, ...]:
    kind = str(node.get("objectType", "")).removeprefix("OBJECT_").lower()
    raw_object = node.get("object", {})
    if kind == "function":
        object_id = _function_reference(raw_object)
    elif kind == "schema":
        names = _node_name_parts(raw_object)
        if len(names) != 1:
            raise ManifestCoverageError("schema owner target is ambiguous")
        object_id = schema_id(names[0], parsed=True)
    elif kind == "publication":
        names = _node_name_parts(raw_object)
        if len(names) != 1:
            raise ManifestCoverageError("publication owner target is ambiguous")
        object_id = resource_id("publication", names[0])
    else:
        return (
            _operation(
                statement,
                action=f"unclassified:owner_{kind or 'unknown'}",
                object_id=None,
                object_type=None,
                classification="unclassified",
            ),
        )
    return (
        _operation(
            statement,
            action="owner",
            object_id=object_id,
            object_type=kind,
        ),
    )


def _classify_comment(statement: ParsedStatement, node: dict[str, Any]) -> tuple[Operation, ...]:
    kind = str(node.get("objtype", "")).removeprefix("OBJECT_").lower()
    names = _node_name_parts(node.get("object", {}))
    if kind == "table" and len(names) == 2:
        object_id = table_id(names, parsed=True)
    elif kind == "column" and len(names) == 3:
        object_id = nested_relation_id("column", names[0], names[1], names[2], parsed=True)
    elif kind == "schema" and len(names) == 1:
        object_id = schema_id(names[0], parsed=True)
    else:
        return (
            _operation(
                statement,
                action=f"unclassified:comment_{kind or 'unknown'}",
                object_id=None,
                object_type=None,
                classification="unclassified",
            ),
        )
    return (_operation(statement, action="comment", object_id=object_id, object_type=kind),)


def _classify_drop(statement: ParsedStatement, node: dict[str, Any]) -> tuple[Operation, ...]:
    kind = str(node.get("removeType", "")).removeprefix("OBJECT_").lower()
    operations: list[Operation] = []
    for ordinal, raw_object in enumerate(node.get("objects", [])):
        names = _node_name_parts(raw_object)
        if kind == "policy" and len(names) == 3:
            object_id = policy_id(names[0], names[1], names[2], parsed=True)
        elif kind == "trigger" and len(names) == 3:
            object_id = trigger_id(names[0], names[1], names[2], parsed=True)
        elif len(names) == 2:
            object_id = relation_id(kind, names[0], names[1], parsed=True)
        elif names:
            object_id = resource_reference_id(
                f"drop.{kind}.{names[-1]}", statement.statement_sha256
            )
        else:
            raise ManifestCoverageError(f"DROP {kind} target is ambiguous")
        operations.append(
            _operation(
                statement,
                action="drop",
                object_id=object_id,
                object_type=kind if len(names) >= 2 else "resource_reference",
                ordinal=ordinal,
            )
        )
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
        if len(names) != 2:
            raise ManifestCoverageError("enum type is not schema-qualified")
        return (_operation(statement, action="create", object_id=relation_id("type", names[0], names[1], parsed=True), object_type="type"),)
    if statement.node_type == "AlterEnumStmt":
        names = _string_values(node.get("typeName"))
        if len(names) != 2:
            raise ManifestCoverageError("enum type is not schema-qualified")
        return (
            _operation(
                statement,
                action="alter_enum",
                object_id=relation_id("type", names[0], names[1], parsed=True),
                object_type="type",
            ),
        )
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
    if statement.node_type == "AlterDefaultPrivilegesStmt":
        action = node.get("action", {})
        return (
            _reference_operation(
                statement,
                "default_privileges",
                "grant_default" if action.get("is_grant") is True else "revoke_default",
                classification="object_operation",
            ),
        )
    if statement.node_type == "AlterOwnerStmt":
        return _classify_owner(statement, node)
    if statement.node_type == "CommentStmt":
        return _classify_comment(statement, node)
    if statement.node_type == "RenameStmt":
        kind = str(node.get("renameType", "")).removeprefix("OBJECT_").lower()
        names = _node_name_parts(node.get("object", {}))
        if kind == "type" and len(names) == 2:
            return (
                _operation(
                    statement,
                    action="rename",
                    object_id=relation_id("type", names[0], names[1], parsed=True),
                    object_type="type",
                ),
            )
        return (
            _operation(
                statement,
                action=f"unclassified:rename_{kind or 'unknown'}",
                object_id=None,
                object_type=None,
                classification="unclassified",
            ),
        )
    if statement.node_type == "DropStmt":
        return _classify_drop(statement, node)
    if statement.node_type == "VariableSetStmt":
        return (
            _operation(
                statement,
                action="set_config",
                object_id=None,
                object_type=None,
                classification="control_operation",
            ),
        )
    if statement.node_type == "SelectStmt":
        targets = node.get("targetList", [])
        function_names: list[list[str]] = []
        for target in targets:
            raw_names = (
                target.get("ResTarget", {})
                .get("val", {})
                .get("FuncCall", {})
                .get("funcname")
            )
            if raw_names:
                function_names.append(_string_values(raw_names))
        if function_names == [["pg_catalog", "set_config"]]:
            return (
                _operation(
                    statement,
                    action="set_config",
                    object_id=None,
                    object_type=None,
                    classification="control_operation",
                ),
            )
        target = "select"
        if len(function_names) == 1:
            target = "select_function." + ".".join(function_names[0])
        return (_reference_operation(statement, target, "call_review_required"),)
    if statement.node_type in {"InsertStmt", "UpdateStmt"}:
        schema, relation = _range_parts(node.get("relation", {}))
        verb = "insert" if statement.node_type == "InsertStmt" else "update"
        return (
            _reference_operation(
                statement,
                f"{verb}.{schema}.{relation}",
                f"{verb}_review_required",
            ),
        )
    if statement.node_type == "DoStmt":
        return (_reference_operation(statement, "do_block", "do_review_required"),)
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
