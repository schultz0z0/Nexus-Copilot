from __future__ import annotations

import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.classifier import classify_sql  # noqa: E402
from supabase_ledger.model import SourceFile, SourceSnapshot  # noqa: E402
from supabase_ledger.resources import (  # noqa: E402
    RemovedComponentError,
    assert_removed_component_action,
    source_resource_operations,
)


FIXTURE = Path(__file__).parent / "fixtures/sql/resource_cases.sql"


class ResourceTests(unittest.TestCase):
    def test_extracts_constant_bucket_ids_without_persisting_values_or_job_payload(self) -> None:
        operations = classify_sql(FIXTURE.read_text(encoding="utf-8"), "active/resources.sql")
        object_ids = {item.object_id for item in operations}

        self.assertIn("bucket:avatars", object_ids)
        self.assertIn("bucket:chat-attachments", object_ids)
        self.assertIn("job:cron%2Eschedule:approval-expiry", object_ids)
        serialized = repr(operations)
        self.assertNotIn("expire_approvals", serialized)
        self.assertNotIn("*/5", serialized)

    def test_dynamic_bucket_id_requires_review_instead_of_guessing(self) -> None:
        sql = "INSERT INTO storage.buckets (id, name) SELECT bucket_id, bucket_id FROM app.settings;"

        operations = classify_sql(sql, "active/dynamic_bucket.sql")

        self.assertEqual(1, len(operations))
        self.assertEqual("data_operation", operations[0].classification)
        self.assertEqual("review_required", operations[0].action)
        self.assertTrue(operations[0].object_id.startswith("resource_reference:storage%2Ebuckets:"))
        self.assertNotIn("bucket_id", repr(operations[0]))

    def test_discovers_edge_functions_and_consolidates_retired_policy_sources(self) -> None:
        snapshot = SourceSnapshot(
            files=(
                SourceFile(
                    policy_id="edge_functions",
                    kind="edge_function",
                    path="apps/chat-web/supabase/functions/admin-create-user",
                    sha256="1" * 64,
                    size=10,
                ),
                SourceFile(
                    policy_id="retired_rag_mcp_migrations",
                    kind="removed_component",
                    path="services/rag-mcp/supabase/migrations/one.sql",
                    sha256="2" * 64,
                    size=20,
                ),
                SourceFile(
                    policy_id="retired_rag_mcp_migrations",
                    kind="removed_component",
                    path="services/rag-mcp/supabase/migrations/two.sql",
                    sha256="3" * 64,
                    size=30,
                ),
            )
        )

        operations = source_resource_operations(snapshot)

        self.assertEqual(
            {"edge_function:admin-create-user", "removed_component:retired_rag_mcp_migrations"},
            {item.object_id for item in operations},
        )
        retired = next(item for item in operations if item.object_type == "removed_component")
        self.assertEqual("remove", retired.action)
        self.assertEqual("2" * 64, retired.statement_sha256)

    def test_retired_components_can_only_be_removed_or_transformed(self) -> None:
        assert_removed_component_action("removed_component:retired_graph_mcp_service", "remove")
        assert_removed_component_action("removed_component:retired_graph_mcp_service", "transform")

        with self.assertRaisesRegex(RemovedComponentError, "cannot migrate"):
            assert_removed_component_action("removed_component:retired_graph_mcp_service", "migrate")


if __name__ == "__main__":
    unittest.main()
