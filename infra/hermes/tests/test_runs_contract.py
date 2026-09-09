"""Live contract checks for the pinned Hermes Runs API container."""

import os
import unittest

from test_smoke import REQUIRED_RUN_FEATURES, assert_runs_contract


@unittest.skipUnless(
    os.environ.get("HERMES_CONTRACT_BASE_URL"),
    "set HERMES_CONTRACT_BASE_URL to run the live Hermes contract",
)
class HermesRunsContractTest(unittest.TestCase):
    def test_pinned_runtime_exposes_authenticated_runs_contract(self) -> None:
        api_key = os.environ.get("API_SERVER_KEY")
        self.assertTrue(api_key, "API_SERVER_KEY must be set for the live contract")

        capabilities = assert_runs_contract(
            os.environ["HERMES_CONTRACT_BASE_URL"],
            api_key,
        )

        self.assertEqual(
            [name for name in REQUIRED_RUN_FEATURES if capabilities["features"].get(name) is not True],
            [],
        )


if __name__ == "__main__":
    unittest.main()
