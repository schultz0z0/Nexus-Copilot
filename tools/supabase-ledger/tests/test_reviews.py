from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.decisions import generate_decision_document  # noqa: E402
from supabase_ledger.reviews import (  # noqa: E402
    ReviewValidationError,
    apply_review_overlay,
    load_reviews,
)


def sample_manifest() -> dict:
    return {
        "format_version": 1,
        "operations": [],
        "objects": [
            {
                "object_id": "grant:table%3Apublic%2Eprofiles:authenticated:all",
                "object_type": "grant",
                "lifecycle": "present",
                "operation_count": 1,
            },
            {
                "object_id": "table:public.profiles",
                "object_type": "table",
                "lifecycle": "present",
                "operation_count": 1,
            },
        ],
        "summary": {
            "operation_count": 0,
            "object_count": 2,
            "unclassified_count": 0,
        },
    }


class ReviewTests(unittest.TestCase):
    def test_apply_review_overlay_marks_approved_and_updates_fields(self) -> None:
        manifest = sample_manifest()
        document = generate_decision_document(manifest)
        overlay = [
            {
                "object_id": "grant:table%3Apublic%2Eprofiles:authenticated:all",
                "action": "remove",
                "target_component": "app-api",
                "target_name": "authorization-without-supabase-role",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "supabase_runtime_removal",
            }
        ]

        reviewed = apply_review_overlay(document, overlay)

        self.assertEqual("approved", reviewed["decisions"][0]["review_status"])
        self.assertEqual("remove", reviewed["decisions"][0]["action"])
        self.assertEqual("authorization-without-supabase-role", reviewed["decisions"][0]["target_name"])
        # Ensure second object remained proposed
        self.assertEqual("proposed", reviewed["decisions"][1]["review_status"])
        # Ensure immutability of original document
        self.assertEqual("proposed", document["decisions"][0]["review_status"])

    def test_rejects_orphan_duplicate_and_wildcard_reviews(self) -> None:
        manifest = sample_manifest()
        document = generate_decision_document(manifest)

        orphan = [
            {
                "object_id": "table:public.non_existent",
                "action": "transform",
                "target_component": "iam",
                "target_name": "iam.principals",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "identity_canonicalization",
            }
        ]
        self.assertRaisesRegex(
            ReviewValidationError,
            "orphan",
            apply_review_overlay,
            document,
            orphan,
        )

        duplicate = [
            {
                "object_id": "table:public.profiles",
                "action": "transform",
                "target_component": "iam",
                "target_name": "iam.principals",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "identity_canonicalization",
            },
            {
                "object_id": "table:public.profiles",
                "action": "transform",
                "target_component": "iam",
                "target_name": "iam.principals",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "identity_canonicalization",
            },
        ]
        self.assertRaisesRegex(
            ReviewValidationError,
            "duplicate",
            apply_review_overlay,
            document,
            duplicate,
        )

        wildcard = [
            {
                "object_id": "grant:table%3Apublic%2Eprofiles:*",
                "action": "remove",
                "target_component": "app-api",
                "target_name": "authorization-without-supabase-role",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "supabase_runtime_removal",
            }
        ]
        self.assertRaisesRegex(
            ReviewValidationError,
            "wildcard",
            apply_review_overlay,
            document,
            wildcard,
        )

    def test_requires_destination_for_approved_transform_and_reason_for_approved_remove(self) -> None:
        manifest = sample_manifest()
        document = generate_decision_document(manifest)

        missing_target = [
            {
                "object_id": "table:public.profiles",
                "action": "transform",
                "target_component": "iam",
                "target_name": None,
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "identity_canonicalization",
            }
        ]
        self.assertRaisesRegex(
            ReviewValidationError,
            "target",
            apply_review_overlay,
            document,
            missing_target,
        )

        missing_reason = [
            {
                "object_id": "grant:table%3Apublic%2Eprofiles:authenticated:all",
                "action": "remove",
                "target_component": "app-api",
                "target_name": "authorization-without-supabase-role",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": None,
            }
        ]
        self.assertRaisesRegex(
            ReviewValidationError,
            "reason",
            apply_review_overlay,
            document,
            missing_reason,
        )

        pending_approved = [
            {
                "object_id": "table:public.profiles",
                "action": "pending",
                "target_component": "iam",
                "target_name": "iam.principals",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "identity_canonicalization",
            }
        ]
        self.assertRaisesRegex(
            ReviewValidationError,
            "pending",
            apply_review_overlay,
            document,
            pending_approved,
        )

    def test_load_reviews_from_file_and_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            file_a = root / "a.json"
            file_b = root / "b.json"

            item_a = {
                "object_id": "grant:table%3Apublic%2Eprofiles:authenticated:all",
                "action": "remove",
                "target_component": "app-api",
                "target_name": "authorization-without-supabase-role",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "supabase_runtime_removal",
            }
            item_b = {
                "object_id": "table:public.profiles",
                "action": "transform",
                "target_component": "iam",
                "target_name": "iam.principals",
                "milestone": "M4",
                "review_status": "approved",
                "reason_code": "identity_canonicalization",
            }

            file_a.write_text(json.dumps({"reviews": [item_a]}), encoding="utf-8")
            file_b.write_text(json.dumps([item_b]), encoding="utf-8")

            loaded_file = load_reviews(file_a)
            self.assertEqual([item_a], loaded_file)

            loaded_dir = load_reviews(root)
            self.assertEqual([item_a, item_b], loaded_dir)


if __name__ == "__main__":
    unittest.main()
