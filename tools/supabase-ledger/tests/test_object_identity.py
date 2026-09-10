from __future__ import annotations

import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from supabase_ledger.object_identity import (  # noqa: E402
    ObjectIdentityError,
    function_id,
    grant_id,
    normalize_identifier,
    policy_id,
    table_id,
    trigger_id,
)


class ObjectIdentityTests(unittest.TestCase):
    def test_normalizes_unquoted_names_and_preserves_quoted_names(self) -> None:
        self.assertEqual("profiles", normalize_identifier("Profiles", quoted=False))
        self.assertEqual("Case%20Sensitive", normalize_identifier("Case Sensitive", quoted=True))
        self.assertEqual("Has%2EDot", normalize_identifier("Has.Dot", quoted=True))

    def test_requires_schema_qualification_for_tables(self) -> None:
        self.assertEqual("table:public.profiles", table_id(["public", "profiles"]))
        with self.assertRaisesRegex(ObjectIdentityError, "schema-qualified"):
            table_id(["profiles"])

    def test_function_signatures_keep_overloads_distinct(self) -> None:
        uuid_function = function_id("public", "lookup", ["uuid"])
        text_function = function_id("public", "lookup", ["text"])

        self.assertEqual("function:public.lookup(uuid)", uuid_function)
        self.assertNotEqual(uuid_function, text_function)
        self.assertEqual(
            "function:public.lookup(timestamp%20with%20time%20zone)",
            function_id("PUBLIC", "LOOKUP", ["  TIMESTAMP   WITH TIME ZONE  "]),
        )

    def test_policy_and_trigger_identity_include_the_table(self) -> None:
        self.assertNotEqual(
            policy_id("public", "campaigns", "tenant_read"),
            policy_id("public", "profiles", "tenant_read"),
        )
        self.assertNotEqual(
            trigger_id("public", "campaigns", "touch_updated"),
            trigger_id("public", "profiles", "touch_updated"),
        )

    def test_grants_have_stable_role_and_privilege_order(self) -> None:
        object_id = "table:public.profiles"
        self.assertEqual(
            "grant:table%3Apublic%2Eprofiles:nexus_app:insert%2Cselect%2Cupdate",
            grant_id(object_id, "NEXUS_APP", ["UPDATE", "SELECT", "INSERT", "SELECT"]),
        )


if __name__ == "__main__":
    unittest.main()
