from __future__ import annotations

import copy
import json
from collections import Counter
from pathlib import Path
from typing import Any

from .decisions import (
    ALLOWED_ACTIONS,
    ALLOWED_MILESTONES,
    ALLOWED_REASON_CODES,
    ALLOWED_REVIEW_STATUSES,
)


class ReviewValidationError(ValueError):
    """Raised when an overlay review entry is invalid, duplicated, orphaned, or contains wildcards."""


def _extract_items(overlay: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(overlay, list):
        return overlay
    if isinstance(overlay, dict):
        if "reviews" in overlay and isinstance(overlay["reviews"], list):
            return overlay["reviews"]
        if "decisions" in overlay and isinstance(overlay["decisions"], list):
            return overlay["decisions"]
        if "object_id" in overlay:
            return [overlay]
    raise ReviewValidationError("overlay must be a list or object containing a 'reviews' list")


def _validate_review_item(item: dict[str, Any]) -> None:
    if not isinstance(item, dict):
        raise ReviewValidationError("each review item must be a JSON object")

    object_id = item.get("object_id")
    if not isinstance(object_id, str) or not object_id:
        raise ReviewValidationError("review object_id must be a non-empty string")

    if any(char in object_id for char in ("*", "?", "[", "]")):
        raise ReviewValidationError(f"wildcard object_id is not allowed: {object_id}")

    action = item.get("action")
    if action not in ALLOWED_ACTIONS:
        raise ReviewValidationError(f"invalid action '{action}' for {object_id}")

    target_component = item.get("target_component")
    if not isinstance(target_component, str) or not target_component:
        raise ReviewValidationError(f"invalid target_component for {object_id}")

    target_name = item.get("target_name")
    if target_name is not None and not isinstance(target_name, str):
        raise ReviewValidationError(f"invalid target_name for {object_id}")

    milestone = item.get("milestone")
    if milestone not in ALLOWED_MILESTONES:
        raise ReviewValidationError(f"invalid milestone '{milestone}' for {object_id}")

    review_status = item.get("review_status")
    if review_status not in ALLOWED_REVIEW_STATUSES:
        raise ReviewValidationError(f"invalid review_status '{review_status}' for {object_id}")

    reason_code = item.get("reason_code")
    if reason_code not in ALLOWED_REASON_CODES:
        raise ReviewValidationError(f"invalid reason_code '{reason_code}' for {object_id}")

    if review_status == "approved":
        if action == "pending":
            raise ReviewValidationError(f"approved decision cannot be pending for {object_id}")
        if action == "transform" and (not target_name or not target_name.strip()):
            raise ReviewValidationError(
                f"approved transform requires non-empty target destination (target_name) for {object_id}"
            )
        if action == "remove" and (not reason_code or not reason_code.strip()):
            raise ReviewValidationError(
                f"approved remove requires explicit reason_code for {object_id}"
            )


def apply_review_overlay(
    document: dict[str, Any],
    overlay: dict[str, Any] | list[dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(document, dict) or "decisions" not in document:
        raise ReviewValidationError("document must be a decision dictionary with a 'decisions' list")
    decisions = document.get("decisions")
    if not isinstance(decisions, list):
        raise ReviewValidationError("decisions in document must be a list")

    items = _extract_items(overlay)

    # Check for duplicates in overlay
    object_ids = [item.get("object_id") for item in items if isinstance(item, dict)]
    duplicates = [oid for oid, count in Counter(object_ids).items() if count > 1]
    if duplicates:
        raise ReviewValidationError(f"duplicate review for object_id: {', '.join(duplicates)}")

    existing_by_id = {
        d["object_id"]: d
        for d in decisions
        if isinstance(d, dict) and isinstance(d.get("object_id"), str)
    }

    # Validate each item and check for orphans
    for item in items:
        _validate_review_item(item)
        object_id = item["object_id"]
        if object_id not in existing_by_id:
            raise ReviewValidationError(f"orphan review for unknown object_id: {object_id}")

    # Deep copy document to keep input immutable
    cloned = copy.deepcopy(document)
    cloned_decisions = cloned["decisions"]

    # Apply overlay updates
    overlay_by_id = {item["object_id"]: item for item in items}
    for row in cloned_decisions:
        oid = row.get("object_id")
        if oid in overlay_by_id:
            review = overlay_by_id[oid]
            row["action"] = review["action"]
            row["target_component"] = review["target_component"]
            row["target_name"] = review.get("target_name")
            row["milestone"] = review["milestone"]
            row["review_status"] = review["review_status"]
            row["reason_code"] = review["reason_code"]

    cloned_decisions.sort(key=lambda d: d["object_id"])
    return cloned


def load_reviews(path: Path) -> list[dict[str, Any]]:
    if path.is_file():
        try:
            content = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ReviewValidationError(f"cannot load review file {path}") from error
        return _extract_items(content)

    if path.is_dir():
        combined: list[dict[str, Any]] = []
        for file in sorted(path.glob("*.json")):
            try:
                content = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise ReviewValidationError(f"cannot load review file {file}") from error
            combined.extend(_extract_items(content))

        # Check for duplicates across directory files
        object_ids = [item.get("object_id") for item in combined if isinstance(item, dict)]
        duplicates = [oid for oid, count in Counter(object_ids).items() if count > 1]
        if duplicates:
            raise ReviewValidationError(f"duplicate review for object_id across files: {', '.join(duplicates)}")
        return combined

    raise ReviewValidationError(f"reviews path does not exist: {path}")
