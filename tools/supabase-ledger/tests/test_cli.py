from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.cli import run_render, run_scan, run_verify  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
