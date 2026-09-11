from __future__ import annotations

import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.decisions import generate_decision_document  # noqa: E402
from supabase_ledger.render import render_markdown  # noqa: E402
from supabase_ledger.sanitize import ArtifactSafetyError, assert_safe_artifact  # noqa: E402


class RenderTests(unittest.TestCase):
    def test_renders_counts_and_one_decision_row_per_object(self) -> None:
        manifest = {
            "format_version": 1,
            "operations": [],
            "objects": [
                {
                    "object_id": "bucket:avatars",
                    "object_type": "bucket",
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
            "summary": {"operation_count": 0, "object_count": 2, "unclassified_count": 0},
        }
        decisions = generate_decision_document(manifest)

        rendered = render_markdown(manifest, decisions)

        self.assertIn("Objects: 2", rendered)
        self.assertEqual(1, rendered.count("bucket:avatars"))
        self.assertEqual(1, rendered.count("table:public.profiles"))
        self.assertNotIn("CREATE TABLE", rendered)
        self.assertTrue(rendered.endswith("\n"))

    def test_rejects_absolute_paths_and_common_secret_shapes_without_echoing_values(self) -> None:
        unsafe_values = [
            "C:\\Users\\operator\\source.sql",
            "/opt/private/source.sql",
            "postgresql://user:password@database/db",
            "sk-abcdefghijklmnopqrstuvwxyz123456",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
        ]
        for unsafe in unsafe_values:
            with self.subTest(unsafe=unsafe):
                with self.assertRaises(ArtifactSafetyError) as context:
                    assert_safe_artifact({"nested": [unsafe]})
                self.assertNotIn(unsafe, str(context.exception))


    def test_renders_domain_summary_and_separates_approved_and_proposed_decisions(self) -> None:
        manifest = {
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
            "summary": {"operation_count": 0, "object_count": 2, "unclassified_count": 0},
        }
        decisions = generate_decision_document(manifest)
        decisions["decisions"][0].update(
            {
                "action": "remove",
                "target_component": "app-api",
                "target_name": "authorization-without-supabase-role",
                "review_status": "approved",
                "reason_code": "supabase_runtime_removal",
            }
        )

        rendered = render_markdown(manifest, decisions)

        self.assertIn("## Domain summary", rendered)
        self.assertIn("| app-api | 1 | 1 | 0 | 0 |", rendered)
        self.assertIn("| iam | 1 | 0 | 1 | 0 |", rendered)
        self.assertIn("## Approved decisions", rendered)
        self.assertIn("grant:table%3Apublic%2Eprofiles:authenticated:all", rendered)
        self.assertIn("## Proposed decisions", rendered)
        self.assertIn("table:public.profiles", rendered)


if __name__ == "__main__":
    unittest.main()
