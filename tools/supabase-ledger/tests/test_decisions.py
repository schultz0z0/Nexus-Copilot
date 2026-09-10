from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.decisions import (  # noqa: E402
    DecisionValidationError,
    generate_decision_document,
    manifest_digest,
    propose_decision,
    verify_decisions,
)


def manifest_for(*object_ids: str) -> dict:
    return {
        "format_version": 1,
        "operations": [],
        "objects": [
            {
                "object_id": object_id,
                "object_type": object_id.split(":", 1)[0],
                "lifecycle": "present",
                "operation_count": 1,
            }
            for object_id in object_ids
        ],
        "summary": {
            "operation_count": 0,
            "object_count": len(object_ids),
            "unclassified_count": 0,
        },
    }


class DecisionTests(unittest.TestCase):
    def test_proposes_destinations_for_owned_and_removed_capabilities(self) -> None:
        cases = {
            "table:public.profiles": ("transform", "iam", "M4"),
            "table:public.chat_sessions": ("transform", "chat-store", "M4"),
            "table:marketing_ops.campaigns": ("transform", "marketing-ops-postgres", "M5"),
            "grant:table%3Amarketing_ops%2Ecampaigns:authenticated:select": (
                "transform",
                "marketing-ops-postgres",
                "M5",
            ),
            "grant:table%3Apublic%2Eprofiles:authenticated:select": (
                "transform",
                "iam",
                "M4",
            ),
            "table:public.picture_jobs": ("transform", "picture-service", "M5"),
            "bucket:avatars": ("transform", "artifact-server", "M5"),
            "edge_function:admin-create-user": ("transform", "app-api", "M4"),
            "edge_function:proxy-chatbot": ("transform", "chat-bridge", "M4"),
            "table:auth.users": ("transform", "iam", "M4"),
            "table:storage.objects": ("transform", "artifact-server", "M5"),
            "table:realtime.messages": ("remove", "none", "M5"),
            "extension:supabase_vault": ("remove", "runtime-secrets", "M5"),
            "table:public.graph_entities": ("remove", "relational-review", "M5"),
            "grant:table%3Apublic%2Egraph_entities:authenticated:select": (
                "remove",
                "relational-review",
                "M5",
            ),
            "removed_component:retired_graph_mcp_service": ("remove", "none", "M5"),
            "table:public.rag_ens": ("pending", "rag-adr", "M5"),
            "extension:vector": ("pending", "postgresql-extension-review", "M3"),
        }

        for object_id, expected in cases.items():
            with self.subTest(object_id=object_id):
                decision = propose_decision(object_id)
                self.assertEqual(expected, (decision["action"], decision["target_component"], decision["milestone"]))
                self.assertEqual("proposed", decision["review_status"])

    def test_generates_exactly_one_explicit_row_per_manifest_object(self) -> None:
        manifest = manifest_for("table:public.profiles", "bucket:avatars")

        document = generate_decision_document(manifest)

        self.assertEqual(manifest_digest(manifest), document["manifest_sha256"])
        self.assertEqual(
            ["bucket:avatars", "table:public.profiles"],
            [item["object_id"] for item in document["decisions"]],
        )
        verify_decisions(manifest, document)

    def test_preserves_an_existing_reviewed_decision_semantically(self) -> None:
        old_manifest = manifest_for("table:public.profiles")
        existing = generate_decision_document(old_manifest)
        existing["decisions"][0].update(
            {
                "action": "transform",
                "target_component": "iam",
                "target_name": "iam.principals",
                "review_status": "approved",
                "reason_code": "identity_canonicalization",
            }
        )
        new_manifest = manifest_for("table:public.profiles", "bucket:avatars")

        refreshed = generate_decision_document(new_manifest, existing=existing)

        preserved = next(item for item in refreshed["decisions"] if item["object_id"] == "table:public.profiles")
        self.assertEqual(existing["decisions"][0], preserved)
        self.assertEqual(manifest_digest(new_manifest), refreshed["manifest_sha256"])

    def test_refreshes_unapproved_proposals_when_rules_change(self) -> None:
        manifest = manifest_for(
            "grant:table%3Amarketing_ops%2Ecampaigns:authenticated:select"
        )
        existing = generate_decision_document(manifest)
        existing["decisions"][0].update(
            {
                "action": "pending",
                "target_component": "domain-review",
                "milestone": "M6",
                "reason_code": "manual_domain_review",
            }
        )

        refreshed = generate_decision_document(manifest, existing=existing)

        self.assertEqual("proposed", refreshed["decisions"][0]["review_status"])
        self.assertEqual("marketing-ops-postgres", refreshed["decisions"][0]["target_component"])

    def test_rejects_missing_duplicate_or_orphan_decisions(self) -> None:
        manifest = manifest_for("table:public.profiles", "bucket:avatars")
        valid = generate_decision_document(manifest)

        missing = copy.deepcopy(valid)
        missing["decisions"].pop()
        with self.assertRaisesRegex(DecisionValidationError, "missing decision"):
            verify_decisions(manifest, missing)

        duplicate = copy.deepcopy(valid)
        duplicate["decisions"].append(copy.deepcopy(duplicate["decisions"][0]))
        with self.assertRaisesRegex(DecisionValidationError, "duplicate decision"):
            verify_decisions(manifest, duplicate)

        orphan = copy.deepcopy(valid)
        orphan["decisions"].append(propose_decision("table:public.orphan"))
        with self.assertRaisesRegex(DecisionValidationError, "orphan decision"):
            verify_decisions(manifest, orphan)

    def test_rejects_stale_format_digest_and_invalid_review_states(self) -> None:
        manifest = manifest_for("table:public.rag_ens", "removed_component:retired_graph_mcp_service")
        valid = generate_decision_document(manifest)

        stale = copy.deepcopy(valid)
        stale["manifest_sha256"] = "0" * 64
        with self.assertRaisesRegex(DecisionValidationError, "manifest digest"):
            verify_decisions(manifest, stale)

        incompatible = copy.deepcopy(valid)
        incompatible["format_version"] = 2
        with self.assertRaisesRegex(DecisionValidationError, "format_version"):
            verify_decisions(manifest, incompatible)

        approved_pending = copy.deepcopy(valid)
        approved_pending["decisions"][1]["review_status"] = "approved"
        with self.assertRaisesRegex(DecisionValidationError, "approved decision cannot be pending"):
            verify_decisions(manifest, approved_pending)

        retired_migrate = copy.deepcopy(valid)
        retired_migrate["decisions"][0]["action"] = "migrate"
        with self.assertRaisesRegex(DecisionValidationError, "cannot migrate"):
            verify_decisions(manifest, retired_migrate)

        invalid_action = copy.deepcopy(valid)
        invalid_action["decisions"][0]["action"] = "copy"
        with self.assertRaisesRegex(DecisionValidationError, "invalid action"):
            verify_decisions(manifest, invalid_action)

        invalid_milestone = copy.deepcopy(valid)
        invalid_milestone["decisions"][0]["milestone"] = "M9"
        with self.assertRaisesRegex(DecisionValidationError, "invalid milestone"):
            verify_decisions(manifest, invalid_milestone)

        invalid_reason = copy.deepcopy(valid)
        invalid_reason["decisions"][0]["reason_code"] = "free-form explanation"
        with self.assertRaisesRegex(DecisionValidationError, "invalid reason_code"):
            verify_decisions(manifest, invalid_reason)


if __name__ == "__main__":
    unittest.main()
