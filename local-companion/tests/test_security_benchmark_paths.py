from pathlib import Path
import os
import subprocess
import pytest
from tda_companion import benchmark_bundles as bundles
from tda_companion import benchmark_quality as quality

@pytest.mark.parametrize("boundary", ["benchmarks", "benchmark", "profiles", "profile", "reference", "revisions", "quality", "quality_profile"])
def test_benchmark_boundaries_reject_directory_redirection(tmp_path: Path, boundary: str):
    data = tmp_path / "data"
    benchmark_id = bundles.benchmark_id_for("security-boundary", 1)
    root = data / "benchmarks" / benchmark_id
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("must remain untouched", encoding="utf-8")
    paths = {
        "benchmarks": data / "benchmarks",
        "benchmark": root,
        "profiles": root / "profiles",
        "profile": root / "profiles" / "qwen-fast",
        "reference": root / "reference",
        "revisions": root / "reference" / "revisions",
        "quality": root / "quality",
        "quality_profile": root / "quality" / "qwen-fast",
    }
    link = paths[boundary]
    assert link.resolve().is_relative_to(tmp_path.resolve())
    assert outside.resolve().is_relative_to(tmp_path.resolve())
    link.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(link), str(outside)], check=True, capture_output=True)
        assert link.is_junction()
    else:
        link.symlink_to(outside, target_is_directory=True)
    calls = {
        "benchmarks": lambda: bundles.benchmark_root(data, benchmark_id),
        "benchmark": lambda: bundles.benchmark_root(data, benchmark_id),
        "profiles": lambda: bundles._profile_root(data, benchmark_id, "qwen-fast"),
        "profile": lambda: bundles._profile_root(data, benchmark_id, "qwen-fast"),
        "reference": lambda: quality._safe_reference_root(data, benchmark_id),
        "revisions": lambda: quality._safe_reference_revisions_root(data, benchmark_id),
        "quality": lambda: quality._safe_quality_root(data, benchmark_id),
        "quality_profile": lambda: quality._quality_receipt_path(data, benchmark_id, "qwen-fast", 1, "a" * 64),
    }
    with pytest.raises((bundles.BenchmarkBundleError, quality.BenchmarkQualityError)):
        calls[boundary]()
    assert sentinel.read_text(encoding="utf-8") == "must remain untouched"
    assert sorted(item.name for item in outside.iterdir()) == ["sentinel.txt"]
