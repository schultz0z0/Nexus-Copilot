from __future__ import annotations

import hashlib
import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.sql_parser import SqlParseError, parse_statements  # noqa: E402


FIXTURE = Path(__file__).parent / "fixtures/sql/parser_cases.sql"


class SqlParserTests(unittest.TestCase):
    def test_parses_multiline_and_dollar_quoted_sql_as_two_statements(self) -> None:
        sql = FIXTURE.read_text(encoding="utf-8")

        statements = parse_statements(sql, "active/parser_cases.sql")

        self.assertEqual(["CreateStmt", "CreateFunctionStmt"], [item.node_type for item in statements])
        self.assertEqual(2, len(statements))
        self.assertEqual(0, statements[0].start_byte)
        self.assertLess(statements[0].end_byte, statements[1].start_byte)
        self.assertEqual("active/parser_cases.sql", statements[1].source_path)
        self.assertIn("CreateFunctionStmt", statements[1].ast)
        self.assertNotIn("RawStmt", statements[1].ast)

        encoded = sql.encode("utf-8")
        expected = hashlib.sha256(
            encoded[statements[1].start_byte : statements[1].end_byte]
        ).hexdigest()
        self.assertEqual(expected, statements[1].statement_sha256)

    def test_parse_errors_expose_only_relative_source_and_position(self) -> None:
        secret_like_sql = "CREATE TABLE broken (token text DEFAULT 'sk-do-not-print'"

        with self.assertRaises(SqlParseError) as caught:
            parse_statements(secret_like_sql, "active/broken.sql")

        message = str(caught.exception)
        self.assertIn("active/broken.sql", message)
        self.assertIn("position", message)
        self.assertNotIn("sk-do-not-print", message)
        self.assertNotIn("CREATE TABLE", message)

    def test_rejects_absolute_source_paths(self) -> None:
        with self.assertRaisesRegex(SqlParseError, "relative source path"):
            parse_statements("SELECT 1;", "C:/legacy/migration.sql")


if __name__ == "__main__":
    unittest.main()
