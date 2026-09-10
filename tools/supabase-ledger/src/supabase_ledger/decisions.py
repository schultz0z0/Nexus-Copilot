from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter
from typing import Any
from urllib.parse import unquote

from .resources import RemovedComponentError, assert_removed_component_action


class DecisionValidationError(ValueError):
    """Raised when the decision ledger is incomplete, stale, or unsafe."""


FORMAT_VERSION = 1
ALLOWED_ACTIONS = frozenset({"migrate", "transform", "remove", "pending"})
ALLOWED_MILESTONES = frozenset({"M3", "M4", "M5", "M6"})
ALLOWED_REVIEW_STATUSES = frozenset({"proposed", "approved"})
ALLOWED_REASON_CODES = frozenset(
    {
        "chat_persistence_migration",
        "edge_function_review",
        "extension_compatibility_review",
        "external_secret_material",
        "file_authority_migration",
        "hermes_boundary",
        "identity_boundary",
        "identity_canonicalization",
        "legacy_object_preserved",
        "manual_domain_review",
        "manual_override",
        "marketing_domain_migration",
        "media_domain_migration",
        "privileged_application_flow",
        "rag_architecture_review",
        "retired_component",
        "retired_graph_capability",
        "supabase_runtime_removal",
    }
)


def manifest_digest(manifest: dict[str, Any]) -> str:
    canonical = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _decision(
    object_id: str,
    action: str,
    target_component: str,
    milestone: str,
    reason_code: str,
) -> dict[str, Any]:
    return {
        "object_id": object_id,
        "action": action,
        "target_component": target_component,
        "target_name": None,
        "milestone": milestone,
        "review_status": "proposed",
        "reason_code": reason_code,
    }


def propose_decision(object_id: str) -> dict[str, Any]:
    """Propose a conservative destination without granting human approval."""
    lowered = unquote(object_id).lower()

    if lowered.startswith("removed_component:"):
        return _decision(object_id, "remove", "none", "M5", "retired_component")
    if lowered.startswith("bucket:") or lowered.startswith("storage_object:"):
        return _decision(
            object_id,
            "transform",
            "artifact-server",
            "M5",
            "file_authority_migration",
        )
    if lowered.startswith("edge_function:"):
        function_name = lowered.split(":", 1)[1]
        if function_name == "proxy-chatbot":
            return _decision(
                object_id,
                "transform",
                "chat-bridge",
                "M4",
                "hermes_boundary",
            )
        if function_name.startswith("admin-"):
            return _decision(
                object_id,
                "transform",
                "app-api",
                "M4",
                "privileged_application_flow",
            )
        return _decision(
            object_id,
            "pending",
            "app-api-review",
            "M5",
            "edge_function_review",
        )
    if lowered == "extension:supabase_vault" or lowered.startswith("schema:vault"):
        return _decision(
            object_id,
            "remove",
            "runtime-secrets",
            "M5",
            "external_secret_material",
        )
    if lowered.startswith("extension:"):
        return _decision(
            object_id,
            "pending",
            "postgresql-extension-review",
            "M3",
            "extension_compatibility_review",
        )
    if any(marker in lowered for marker in ("graph_entities", "graph_relations", "neo4j")):
        return _decision(
            object_id,
            "remove",
            "relational-review",
            "M5",
            "retired_graph_capability",
        )
    if ":public.rag_" in lowered or ":rag_" in lowered or ".rag_" in lowered:
        return _decision(object_id, "pending", "rag-adr", "M5", "rag_architecture_review")
    if ":public.profiles" in lowered or lowered.startswith("table:public.profiles") or "user_chat_integrations" in lowered:
        return _decision(
            object_id,
            "transform",
            "iam",
            "M4",
            "identity_canonicalization",
        )
    if ":public.chat_" in lowered or ":chat_" in lowered:
        return _decision(
            object_id,
            "transform",
            "chat-store",
            "M4",
            "chat_persistence_migration",
        )
    if ":marketing_ops." in lowered or ":marketing_ops_private." in lowered:
        return _decision(
            object_id,
            "transform",
            "marketing-ops-postgres",
            "M5",
            "marketing_domain_migration",
        )
    if any(marker in lowered for marker in ("picture", "image_gen", "generated_image")):
        return _decision(
            object_id,
            "transform",
            "picture-service",
            "M5",
            "media_domain_migration",
        )
    if ":auth." in lowered or lowered.startswith("schema:auth"):
        return _decision(object_id, "transform", "iam", "M4", "identity_boundary")
    if ":storage." in lowered or lowered.startswith("schema:storage"):
        return _decision(
            object_id,
            "transform",
            "artifact-server",
            "M5",
            "file_authority_migration",
        )
    if ":realtime." in lowered or lowered.startswith("schema:realtime"):
        return _decision(object_id, "remove", "none", "M5", "supabase_runtime_removal")

    return _decision(object_id, "pending", "domain-review", "M6", "manual_domain_review")


def generate_decision_document(
    manifest: dict[str, Any],
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    objects = manifest.get("objects")
    if not isinstance(objects, list):
        raise DecisionValidationError("manifest objects must be a list")

    preserved: dict[str, dict[str, Any]] = {}
    if existing is not None:
        decisions = existing.get("decisions")
        if not isinstance(decisions, list):
            raise DecisionValidationError("existing decisions must be a list")
        for item in decisions:
            if (
                isinstance(item, dict)
                and isinstance(item.get("object_id"), str)
                and item.get("review_status") == "approved"
            ):
                preserved[item["object_id"]] = copy.deepcopy(item)

    object_ids = [item.get("object_id") for item in objects if isinstance(item, dict)]
    if len(object_ids) != len(objects) or any(
        not isinstance(object_id, str) or not object_id for object_id in object_ids
    ):
        raise DecisionValidationError("manifest contains an invalid object_id")
    object_ids.sort()

    return {
        "format_version": FORMAT_VERSION,
        "manifest_sha256": manifest_digest(manifest),
        "decisions": [
            preserved.get(object_id, propose_decision(object_id)) for object_id in object_ids
        ],
    }


def _validate_row(row: dict[str, Any]) -> None:
    object_id = row.get("object_id")
    if not isinstance(object_id, str) or not object_id:
        raise DecisionValidationError("decision object_id must be a non-empty string")
    if row.get("action") not in ALLOWED_ACTIONS:
        raise DecisionValidationError(f"invalid action for {object_id}")
    if not isinstance(row.get("target_component"), str) or not row["target_component"]:
        raise DecisionValidationError(f"invalid target_component for {object_id}")
    if row.get("target_name") is not None and not isinstance(row["target_name"], str):
        raise DecisionValidationError(f"invalid target_name for {object_id}")
    if row.get("milestone") not in ALLOWED_MILESTONES:
        raise DecisionValidationError(f"invalid milestone for {object_id}")
    if row.get("review_status") not in ALLOWED_REVIEW_STATUSES:
        raise DecisionValidationError(f"invalid review_status for {object_id}")
    if row.get("reason_code") not in ALLOWED_REASON_CODES:
        raise DecisionValidationError(f"invalid reason_code for {object_id}")
    if row["review_status"] == "approved" and row["action"] == "pending":
        raise DecisionValidationError(
            f"approved decision cannot be pending for {object_id}"
        )
    try:
        assert_removed_component_action(object_id, row["action"])
    except RemovedComponentError as exc:
        raise DecisionValidationError(str(exc)) from exc


def verify_decisions(manifest: dict[str, Any], document: dict[str, Any]) -> None:
    if manifest.get("format_version") != FORMAT_VERSION:
        raise DecisionValidationError("unsupported manifest format_version")
    summary = manifest.get("summary")
    if not isinstance(summary, dict) or summary.get("unclassified_count") != 0:
        raise DecisionValidationError("manifest must have zero unclassified operations")
    if document.get("format_version") != FORMAT_VERSION:
        raise DecisionValidationError("unsupported decision format_version")
    if document.get("manifest_sha256") != manifest_digest(manifest):
        raise DecisionValidationError("decision manifest digest is stale or invalid")

    objects = manifest.get("objects")
    decisions = document.get("decisions")
    if not isinstance(objects, list) or not isinstance(decisions, list):
        raise DecisionValidationError("manifest objects and decisions must be lists")

    manifest_ids = [item.get("object_id") for item in objects if isinstance(item, dict)]
    decision_ids = [item.get("object_id") for item in decisions if isinstance(item, dict)]

    duplicated = sorted(
        object_id
        for object_id, count in Counter(decision_ids).items()
        if isinstance(object_id, str) and count > 1
    )
    if duplicated:
        raise DecisionValidationError("duplicate decision: " + ", ".join(duplicated))

    missing = sorted(set(manifest_ids) - set(decision_ids))
    if missing:
        raise DecisionValidationError("missing decision: " + ", ".join(missing))
    orphaned = sorted(set(decision_ids) - set(manifest_ids))
    if orphaned:
        raise DecisionValidationError("orphan decision: " + ", ".join(orphaned))

    if len(decisions) != len(manifest_ids):
        raise DecisionValidationError("decision cardinality does not match manifest")
    for row in decisions:
        if not isinstance(row, dict):
            raise DecisionValidationError("each decision must be an object")
        _validate_row(row)
