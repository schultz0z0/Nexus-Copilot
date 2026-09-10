from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ContainerContractTests(unittest.TestCase):
    def test_dockerfile_pins_python_digest_installs_hashes_and_runs_non_root(self) -> None:
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

        self.assertRegex(
            dockerfile,
            r"(?m)^FROM python:3\.11(?:\.[0-9]+)?-slim-bookworm@sha256:[0-9a-f]{64}$",
        )
        self.assertIn("--require-hashes", dockerfile)
        self.assertIn("requirements.lock", dockerfile)
        self.assertRegex(dockerfile, r"(?m)^USER ledger$")
        self.assertNotIn("COPY . .", dockerfile)
        self.assertIn('ENTRYPOINT ["python", "/app/ledger.py"]', dockerfile)

    def test_compose_is_offline_read_only_and_has_no_production_integration(self) -> None:
        compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")

        self.assertGreaterEqual(compose.count("network_mode: none"), 3)
        self.assertGreaterEqual(compose.count("read_only: true"), 3)
        self.assertIn("${ENS_LEGACY_ROOT", compose)
        self.assertRegex(compose, r"(?m)^\s+- .*:/legacy:ro$")
        self.assertNotRegex(compose, r"(?m)^\s*(networks|secrets):")
        self.assertNotIn("traefik", compose.lower())
        self.assertNotIn("postgres", compose.lower())

    def test_build_context_excludes_secrets_caches_and_generated_artifacts(self) -> None:
        ignored = (ROOT / ".dockerignore").read_text(encoding="utf-8")

        for pattern in (".env", "__pycache__", "*.pyc", ".git"):
            self.assertIn(pattern, ignored)


if __name__ == "__main__":
    unittest.main()
