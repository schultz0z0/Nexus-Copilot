from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.cli import run_render, run_scan, run_verify  # noqa: E402
from supabase_ledger.manifest import ManifestCoverageError  # noqa: E402


class CliTests(unittest.TestCase):
    def _source_tree(self, root: Path) -> Path:
        migrations = root / "migrations"
        functions = root / "functions" / "proxy-chatbot"
        retired = root / "retired"
        migrations.mkdir(parents=True)
        functions.mkdir(parents=True)
        retired.mkdir(parents=True)
        (migrations / "001.sql").write_text(
            "CREATE TABLE public.profiles (id uuid);\n"
            "CREATE FUNCTION public.hidden() RETURNS int LANGUAGE sql "
            "AS $$ SELECT 42; $$;\n",
            encoding="utf-8",
        )
        (functions / "index.ts").write_text("export const marker = 'not-an-artifact';\n", encoding="utf-8")
        (retired / "package.json").write_text('{"name":"retired-graph"}\n', encoding="utf-8")
        policy = {
            "format_version": 1,
            "sources": [
                {
                    "id": "active",
                    "kind": "active_sql",
                    "match": "file",
                    "globs": ["migrations/*.sql"],
                    "expected_count": 1,
                    "critical": True,
                },
                {
                    "id": "edge",
                    "kind": "edge_function",
                    "match": "directory",
                    "globs": ["functions/*"],
                    "expected_count": 1,
                    "critical": True,
                },
                {
                    "id": "retired_graph_mcp_service",
                    "kind": "removed_component",
                    "match": "file",
                    "globs": ["retired/package.json"],
                    "expected_count": 1,
                    "critical": True,
                },
            ],
        }
        policy_path = root / "policy.json"
        policy_path.write_text(json.dumps(policy), encoding="utf-8")
        return policy_path

    def test_scan_is_byte_deterministic_and_never_persists_sql_or_absolute_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            policy = self._source_tree(root)
            manifest = root / "out" / "source-manifest.json"
            decisions = root / "out" / "object-decisions.json"
            report = root / "out" / "ledger.md"

            run_scan(root, policy, manifest, decisions, report)
            first = (manifest.read_bytes(), decisions.read_bytes(), report.read_bytes())
            run_scan(root, policy, manifest, decisions, report)
            second = (manifest.read_bytes(), decisions.read_bytes(), report.read_bytes())

            self.assertEqual(first, second)
            for artifact in first:
                self.assertNotIn(str(root).encode(), artifact)
                self.assertNotIn(b"SELECT 42", artifact)
                self.assertNotIn(b"not-an-artifact", artifact)
                self.assertTrue(artifact.endswith(b"\n"))
            run_verify(manifest, decisions, report)

    def test_verify_detects_markdown_drift_and_render_repairs_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            policy = self._source_tree(root)
            manifest = root / "source-manifest.json"
            decisions = root / "object-decisions.json"
            report = root / "ledger.md"
            run_scan(root, policy, manifest, decisions, report)
            report.write_text("stale\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "report drift"):
                run_verify(manifest, decisions, report)

            run_render(manifest, decisions, report)
            run_verify(manifest, decisions, report)

    def test_scan_reports_a_bounded_sanitized_list_of_classifier_gaps(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            migrations = root / "migrations"
            migrations.mkdir()
            (migrations / "one.sql").write_text("CREATE TABLE ambiguous_one (id int);", encoding="utf-8")
            (migrations / "two.sql").write_text("CREATE TABLE ambiguous_two (id int);", encoding="utf-8")
            (migrations / "three.sql").write_text(
                "CREATE TYPE ambiguous_enum AS ENUM ('one');", encoding="utf-8"
            )
            policy = root / "policy.json"
            policy.write_text(
                json.dumps(
                    {
                        "format_version": 1,
                        "sources": [
                            {
                                "id": "active",
                                "kind": "active_sql",
                                "match": "file",
                                "globs": ["migrations/*.sql"],
                                "expected_count": 3,
                                "critical": True,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaises(ManifestCoverageError) as context:
                run_scan(root, policy, root / "m.json", root / "d.json", root / "r.md")

            message = str(context.exception)
            self.assertIn("migrations/one.sql", message)
            self.assertIn("migrations/three.sql", message)
            self.assertIn("CreateStmt", message)
            self.assertIn("enum type is not schema-qualified", message)
            self.assertIn("2 occurrences", message)
            self.assertNotIn("ambiguous_one", message)
            self.assertNotIn(str(root), message)


    def test_reviews_overlay_integration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            policy = self._source_tree(root)
            manifest = root / "source-manifest.json"
            decisions = root / "object-decisions.json"
            report = root / "ledger.md"
            reviews_dir = root / "reviews"
            reviews_dir.mkdir()
            (reviews_dir / "iam.json").write_text(
                json.dumps(
                    {
                        "reviews": [
                            {
                                "object_id": "table:public.profiles",
                                "action": "transform",
                                "target_component": "iam",
                                "target_name": "iam.principals",
                                "milestone": "M4",
                                "review_status": "approved",
                                "reason_code": "identity_canonicalization",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            run_scan(root, policy, manifest, decisions, report, reviews_path=reviews_dir)
            loaded_decisions = json.loads(decisions.read_text(encoding="utf-8"))
            profile_decision = next(d for d in loaded_decisions["decisions"] if d["object_id"] == "table:public.profiles")
            self.assertEqual("approved", profile_decision["review_status"])
            self.assertEqual("iam.principals", profile_decision["target_name"])

            # Verify passes with reviews
            run_verify(manifest, decisions, report, reviews_path=reviews_dir)

            # Modifying report causes verify failure
            report.write_text("tampered\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "report drift"):
                run_verify(manifest, decisions, report, reviews_path=reviews_dir)

            # Render repairs it with reviews
            run_render(manifest, decisions, report, reviews_path=reviews_dir)
            run_verify(manifest, decisions, report, reviews_path=reviews_dir)


if __name__ == "__main__":
    unittest.main()
