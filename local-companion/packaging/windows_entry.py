from __future__ import annotations

import sys
from pathlib import Path


def _diagnostic_path() -> Path | None:
    try:
        index = sys.argv.index("--diagnostic-file")
        value = sys.argv[index + 1]
    except (ValueError, IndexError):
        return None
    return Path(value)


def _write_bootstrap_failure(exc: BaseException) -> None:
    path = _diagnostic_path()
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    detail = exc.name if isinstance(exc, ModuleNotFoundError) else type(exc).__name__
    path.write_text(f"BOOTSTRAP_IMPORT_FAILED:{detail}\n", encoding="utf-8")


try:
    from tda_companion.windows_app import main
except BaseException as exc:
    _write_bootstrap_failure(exc)
    raise


if __name__ == "__main__":
    raise SystemExit(main())
