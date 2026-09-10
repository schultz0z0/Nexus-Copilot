from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.source_policy import (  # noqa: E402
    SourcePolicyError,
    discover_sources,
    load_source_policy,
)


class SourcePolicyTests(unittest.TestCase):
    def write_policy(self, root: Path, entries: list[dict]) -> Path:
        path = root / "source-policy.json"
        path.write_text(
            json.dumps({"format_version": 1, "sources": entries}),
            encoding="utf-8",
        )
        return path

    def test_discovers_hashes_and_orders_sanitized_relative_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            migrations = root / "apps/chat-web/supabase/migrations"
            functions = root / "apps/chat-web/supabase/functions/admin-create-user"
            migrations.mkdir(parents=True)
            functions.mkdir(parents=True)
            (migrations / "002_second.sql").write_text("select 2;\n", encoding="utf-8")
            first = migrations / "001_first.sql"
            first.write_text("select 1;\n", encoding="utf-8")
            (functions / "index.ts").write_text("export {};\n", encoding="utf-8")

            policy_path = self.write_policy(
                root,
                [
                    {
                        "id": "active_migrations",
                        "kind": "active_sql",
                        "match": "file",
                        "globs": ["apps/chat-web/supabase/migrations/*.sql"],
                        "expected_count": 2,
                        "critical": True,
                    },
                    {
                        "id": "edge_functions",
                        "kind": "edge_function",
                        "match": "directory",
                        "globs": ["apps/chat-web/supabase/functions/*"],
                        "expected_count": 1,
                        "critical": True,
                    },
                ],
            )

            snapshot = discover_sources(root, load_source_policy(policy_path))

            self.assertEqual(2, snapshot.critical_source_count)
            self.assertEqual(
                [
                    "apps/chat-web/supabase/functions/admin-create-user",
                    "apps/chat-web/supabase/migrations/001_first.sql",
                    "apps/chat-web/supabase/migrations/002_second.sql",
                ],
                [item.path for item in snapshot.files],
            )
            self.assertTrue(all(not Path(item.path).is_absolute() for item in snapshot.files))
            first_source = next(item for item in snapshot.files if item.path.endswith("001_first.sql"))
            self.assertEqual(hashlib.sha256(first.read_bytes()).hexdigest(), first_source.sha256)

    def test_classifies_active_historical_and_removed_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            paths = {
                "active_sql": "active/001.sql",
                "historical_only": "legacy/old.sql",
                "removed_component": "services/rag-mcp/old.sql",
            }
            for relative in paths.values():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("select 1;", encoding="utf-8")
            policy_path = self.write_policy(
                root,
                [
                    {
                        "id": kind,
                        "kind": kind,
                        "match": "file",
                        "globs": [relative],
                        "expected_count": 1,
                        "critical": kind == "active_sql",
                    }
                    for kind, relative in paths.items()
                ],
            )

            snapshot = discover_sources(root, load_source_policy(policy_path))

            self.assertEqual(
                paths,
                {item.kind: item.path for item in snapshot.files},
            )

    def test_rejects_unsafe_globs_duplicate_matches_and_count_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "active/001.sql"
            source.parent.mkdir(parents=True)
            source.write_text("select 1;", encoding="utf-8")

            unsafe = self.write_policy(
                root,
                [
                    {
                        "id": "unsafe",
                        "kind": "active_sql",
                        "match": "file",
                        "globs": ["../outside/*.sql"],
                        "expected_count": 1,
                        "critical": True,
                    }
                ],
            )
            with self.assertRaisesRegex(SourcePolicyError, "unsafe glob"):
                load_source_policy(unsafe)

            duplicate = self.write_policy(
                root,
                [
                    {
                        "id": "one",
                        "kind": "active_sql",
                        "match": "file",
                        "globs": ["active/*.sql"],
                        "expected_count": 1,
                        "critical": True,
                    },
                    {
                        "id": "two",
                        "kind": "historical_only",
                        "match": "file",
                        "globs": ["active/001.sql"],
                        "expected_count": 1,
                        "critical": False,
                    },
                ],
            )
            with self.assertRaisesRegex(SourcePolicyError, "matched by multiple"):
                discover_sources(root, load_source_policy(duplicate))

            drift = self.write_policy(
                root,
                [
                    {
                        "id": "active",
                        "kind": "active_sql",
                        "match": "file",
                        "globs": ["active/*.sql"],
                        "expected_count": 2,
                        "critical": True,
                    }
                ],
            )
            with self.assertRaisesRegex(SourcePolicyError, "expected 2"):
                discover_sources(root, load_source_policy(drift))

    def test_rejects_a_symlink_that_escapes_the_source_root(self) -> None:
        with tempfile.TemporaryDirectory() as source_temp, tempfile.TemporaryDirectory() as outside_temp:
            root = Path(source_temp)
            outside = Path(outside_temp) / "outside.sql"
            outside.write_text("select 1;", encoding="utf-8")
            link = root / "active/escape.sql"
            link.parent.mkdir(parents=True)
            try:
                link.symlink_to(outside)
            except OSError:
                self.skipTest("symlink creation is not available on this Windows host")

            policy_path = self.write_policy(
                root,
                [
                    {
                        "id": "active",
                        "kind": "active_sql",
                        "match": "file",
                        "globs": ["active/*.sql"],
                        "expected_count": 1,
                        "critical": True,
                    }
                ],
            )

            with self.assertRaisesRegex(SourcePolicyError, "escapes source root"):
                discover_sources(root, load_source_policy(policy_path))


if __name__ == "__main__":
    unittest.main()
