"""Rebuild one disposable review summary offline without changing editorial data."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from tda_companion.__main__ import RootLock
from tda_companion.local_review import rebuild_review_summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--package-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    root = args.data_root.resolve(strict=True)
    package = args.package_root.resolve(strict=True)
    if package.parent != (root / "staging").resolve() or not package.is_dir():
        parser.error("PACKAGE_OUTSIDE_DATA_ROOT_STAGING")
    with RootLock(root):
        summary = rebuild_review_summary(package, source_id=package.name, run_id=args.run_id)
    # No transcript text, full hashes, or filesystem paths in output.
    print(json.dumps({"review": summary}))
    if summary is not None and summary["status"] == "unknown":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
