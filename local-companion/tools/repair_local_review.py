"""Offline explicit string repair. Stop the Companion before using this tool.

The input JSON contains the complete corrected `segments` array. No transcript
text is printed. The original draft is preserved byte-for-byte next to the draft.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from tda_companion.local_review import _bounded_json, repair_legacy_review
from tda_companion.__main__ import RootLock


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--package-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--expected-revision", type=int, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--replacement-file", type=Path, required=True)
    args = parser.parse_args()
    package = args.package_root.resolve()
    data_root = args.data_root.resolve(strict=True)
    if package.parent != (data_root / "staging").resolve() or not package.is_dir():
        parser.error("PACKAGE_OUTSIDE_DATA_ROOT_STAGING")
    replacement, _ = _bounded_json(args.replacement_file)
    with RootLock(data_root):
        saved = repair_legacy_review(package, source_id=package.name, run_id=args.run_id,
                                    expected_revision=args.expected_revision,
                                    expected_sha256=args.expected_sha256,
                                    segments=replacement.get("segments"))
    print(json.dumps({"draft_revision": saved["draft_revision"], "draft_sha256": saved["draft_sha256"],
                      "status": saved["status"], "original_preserved": True}))


if __name__ == "__main__":
    main()
