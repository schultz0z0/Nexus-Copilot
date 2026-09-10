from __future__ import annotations

import sys
import unittest
from dataclasses import asdict
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.classifier import (  # noqa: E402
    ManifestCoverageError,
    build_manifest,
    classify_sql,
    classify_statement,
    consolidate_operations,
)
from supabase_ledger.sql_parser import ParsedStatement  # noqa: E402


FIXTURE = Path(__file__).parent / "fixtures/sql/ddl_cases.sql"


class ClassifierTests(unittest.TestCase):
    def test_classifies_every_fixture_statement_without_silent_skips(self) -> None:
        operations = classify_sql(FIXTURE.read_text(encoding="utf-8"), "active/ddl_cases.sql")

        self.assertGreater(len(operations), 18)
        self.assertNotIn("unclassified", {item.classification for item in operations})
        self.assertTrue(all(item.statement_sha256 for item in operations))
        self.assertTrue(all(item.source_path == "active/ddl_cases.sql" for item in operations))

    def test_emits_canonical_objects_for_nested_table_elements(self) -> None:
        operations = classify_sql(FIXTURE.read_text(encoding="utf-8"), "active/ddl_cases.sql")
        object_ids = {item.object_id for item in operations if item.object_id}

        expected = {
            "schema:app",
            "extension:pg_trgm",
            "type:app.mood",
            "sequence:app.item_seq",
            "table:app.items",
            "column:app.items.id",
            "column:app.items.tenant_id",
            "column:app.items.name",
            "constraint:app.items.items_pkey",
            "constraint:app.items.items_tenant_unique",
            "index:app.items_tenant_idx",
            "view:app.item_view",
            "function:app.touch(uuid)",
            "trigger:app.items.items_touch",
            "policy:app.items.Tenant%20read",
            "grant:table%3Aapp%2Eitems:nexus_app:select%2Cupdate",
        }
        self.assertTrue(expected.issubset(object_ids), expected - object_ids)

    def test_records_security_definer_rls_owner_revoke_comment_and_drop(self) -> None:
        operations = classify_sql(FIXTURE.read_text(encoding="utf-8"), "active/ddl_cases.sql")
        actions = {(item.object_id, item.action) for item in operations}

        self.assertIn(("function:app.touch(uuid)", "create_security_definer"), actions)
        self.assertIn(("table:app.items", "enable_rls"), actions)
        self.assertIn(("table:app.items", "force_rls"), actions)
        self.assertIn(("table:app.items", "owner"), actions)
        self.assertTrue(any(item.action == "revoke" for item in operations))
        self.assertIn(("table:app.items", "comment"), actions)
        self.assertIn(("view:app.item_view", "drop"), actions)

    def test_consolidates_object_lifecycle_in_source_order(self) -> None:
        operations = classify_sql(FIXTURE.read_text(encoding="utf-8"), "active/ddl_cases.sql")

        objects = {item.object_id: item for item in consolidate_operations(operations)}

        view = objects["view:app.item_view"]
        self.assertEqual("removed", view.lifecycle)
        self.assertEqual(["create", "drop"], [item.action for item in view.operations])
        table = objects["table:app.items"]
        self.assertEqual("present", table.lifecycle)
        self.assertEqual("create", table.operations[0].action)

    def test_unknown_statement_is_unclassified_and_blocks_manifest(self) -> None:
        statement = ParsedStatement(
            source_path="active/unknown.sql",
            node_type="VacuumStmt",
            start_byte=0,
            end_byte=7,
            statement_sha256="0" * 64,
            ast={"VacuumStmt": {}},
        )

        operations = classify_statement(statement)

        self.assertEqual(1, len(operations))
        self.assertEqual("unclassified", operations[0].classification)
        self.assertIsNone(operations[0].object_id)
        with self.assertRaisesRegex(ManifestCoverageError, "VacuumStmt"):
            build_manifest(operations)

    def test_manifest_contains_only_sanitized_metadata(self) -> None:
        operations = classify_sql(FIXTURE.read_text(encoding="utf-8"), "active/ddl_cases.sql")

        manifest = build_manifest(operations)
        serialized = repr(manifest)

        self.assertNotIn("Inventory fixture", serialized)
        self.assertNotIn("SELECT p_id", serialized)
        self.assertNotIn("raw_sql", serialized)
        self.assertTrue(all("ast" not in asdict(item) for item in operations))


if __name__ == "__main__":
    unittest.main()
