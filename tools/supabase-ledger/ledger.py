from __future__ import annotations

import sys
from pathlib import Path


PACKAGE_SOURCE = Path(__file__).resolve().parent / "src"
sys.path.insert(0, str(PACKAGE_SOURCE))

from supabase_ledger.cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
