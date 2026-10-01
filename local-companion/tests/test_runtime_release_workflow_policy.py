from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"


def _workflow(name: str) -> str:
    return (WORKFLOWS / name).read_text(encoding="utf-8")


def _push_paths(name: str) -> set[str]:
    value = _workflow(name)
    start = value.index("  push:")
    end = value.index("\nconcurrency:", start)
    block = value[start:end]
    return {
        line.strip()[2:].strip("'\"")
        for line in block.splitlines()
        if line.strip().startswith("- '") or line.strip().startswith('- "')
    }


def _runtime_family_input_paths() -> set[str]:
    # Runtime build triggers may be intentionally conservative. Promotion/RC
    # fences must track the actual family-owned package inputs so an unrelated
    # Qwen manifest change cannot invalidate sealed Whisper bytes.
    whisper = _push_paths("whisper-runtime.yml")
    whisper.discard("local-companion/runtime/**")
    whisper.add("local-companion/runtime/whisper-windows-x64.json")
    return (
        whisper
        | _push_paths("qwen-runtime.yml")
        | _push_paths("qwen-runtime-package.yml")
    )


def test_whisper_runtime_workflow_is_build_only_and_keeps_candidate_long_enough():
    value = _workflow("whisper-runtime.yml")

    assert "publish-whisper-runtime-release" not in value
    assert "gh release create" not in value
    assert "TDA_SOURCE_SHA" in value
    assert "BUILD_SOURCE_SHA_MISMATCH" in value
    assert "retention-days: 30" in value


def test_whisper_runtime_build_gates_the_packaged_faster_whisper_decoder():
    build = (REPO_ROOT / "local-companion" / "packaging" / "build_whisper_runtime.py").read_text(
        encoding="utf-8"
    )
    entry = (REPO_ROOT / "local-companion" / "packaging" / "whisper_runtime_entry.py").read_text(
        encoding="utf-8"
    )

    assert '_decode_smoke_worker(worker)' in build
    assert 'probe.get("av") != packages["av"]' in build
    assert '"--decode-smoke"' in entry
    assert "from faster_whisper.audio import decode_audio" in entry
    assert '("wav", wav_path)' in entry
    assert '("flac", flac_path)' in entry
    assert "WHISPER_DECODER_DEPENDENCY_INCOMPATIBLE" in entry


def test_qwen_runtime_uses_package_builder_without_legacy_direct_stable_publisher():
    package = _workflow("qwen-runtime-package.yml")

    assert not (WORKFLOWS / "qwen-runtime-release.yml").exists()
    assert "TDA_SOURCE_SHA" in package
    assert "BUILD_SOURCE_SHA_MISMATCH" in package
    assert "retention-days: 30" in package
    assert "gh release create" not in package


def test_qwen_runtime_package_restores_runtime_rc_only_for_issue_1236_1014():
    package = _workflow("qwen-runtime-package.yml")

    assert 'REPAIR_VERSION="1.0.14"' in package
    assert 'STABLE_TAG="companion-qwen-runtime-v$REPAIR_VERSION"' in package
    assert "QWEN_RUNTIME_RC_1236_VERSION_MISMATCH" in package
    assert "QWEN_RUNTIME_RC_DISABLED_AFTER_1014_STABLE" in package
    assert "disabled_manually|disabled_inactivity" in package
    assert 'gh api --method PUT "repos/$GITHUB_REPOSITORY/actions/workflows/$WORKFLOW/enable"' in package
    assert "QWEN_RUNTIME_RC_WORKFLOW_RESTORE_FAILED" in package
    assert "QWEN_RUNTIME_RC_WORKFLOW_RESTORED issue=1236" in package



def test_whisper_runtime_workflow_tracks_worker_dependency_closure():
    value = _workflow("whisper-runtime.yml")
    required = {
        "local-companion/tda_companion/asr_checkpoints.py",
        "local-companion/tda_companion/asr_timeline.py",
        "local-companion/tda_companion/runtime_artifact.py",
        "local-companion/tda_companion/execution_device.py",
        "local-companion/tda_companion/craig_runtime.py",
        "local-companion/tda_companion/flac_metadata.py",
        "local-companion/tda_companion/transcript.py",
        "local-companion/tda_companion/transcription_runs.py",
        "local-companion/tda_companion/atomic_storage.py",
        "local-companion/tda_companion/attempt_fence.py",
    }
    for path in required:
        assert value.count(path) == 2, f"whisper-runtime.yml must watch {path} on PR and push"


def test_whisper_runtime_family_fences_ignore_qwen_manifest_changes():
    whisper = _workflow("whisper-runtime.yml")
    runtime_rc = _workflow("runtime-rc.yml")
    runtime_promote = _workflow("runtime-promote.yml")
    whisper_manifest = "local-companion/runtime/whisper-windows-x64.json"
    qwen_manifest = "local-companion/runtime/qwen-windows-x64.json"

    # Keep the already-published 1.1.8 build workflow untouched: changing it is
    # itself a protected Whisper input and would invalidate the sealed candidate.
    # The trigger can stay conservative until 1.1.8 is promoted; the byte-drift
    # fences are the place that must be family-specific now.
    assert whisper.count("local-companion/runtime/**") == 2

    for value in (runtime_rc, runtime_promote):
        assert '"local-companion/runtime/**"' not in value
        assert f'"{whisper_manifest}"' in value
        assert f'"{qwen_manifest}"' in value


def test_qwen_runtime_workflows_track_the_strict_worker_dependency_closure():
    required = {
        "local-companion/tda_companion/asr_checkpoints.py",
        "local-companion/tda_companion/asr_qwen_strict.py",
        "local-companion/tda_companion/asr_timeline.py",
        "local-companion/tda_companion/runtime_artifact.py",
        "local-companion/tda_companion/execution_device.py",
        "local-companion/tda_companion/craig_runtime.py",
        "local-companion/tda_companion/flac_metadata.py",
        "local-companion/tda_companion/transcript.py",
        "local-companion/tda_companion/transcription_runs.py",
        "local-companion/tda_companion/atomic_storage.py",
        "local-companion/tda_companion/attempt_fence.py",
    }
    for name in ("qwen-runtime.yml", "qwen-runtime-package.yml"):
        value = _workflow(name)
        for path in required:
            assert value.count(path) == 2, f"{name} must watch {path} on PR and push"



def test_runtime_rc_source_drift_fence_is_family_scoped_to_real_runtime_inputs():
    value = _workflow("runtime-rc.yml")

    assert value.count("RUNTIME_PATHS=(") == 2
    assert 'git diff --quiet "$SOURCE_SHA" origin/main -- "${RUNTIME_PATHS[@]}"' in value
    assert 'git diff --name-only "$SOURCE_SHA" origin/main -- "${RUNTIME_PATHS[@]}"' in value

    # The RC fence must keep up with every file that can trigger an actual runtime
    # build on main, rather than conservatively invalidating the whole Companion tree.
    required = _runtime_family_input_paths()
    missing = sorted(path for path in required if f'"{path}"' not in value)
    assert missing == []

    # Test/acceptance-only changes do not alter packaged runtime bytes.
    assert '"local-companion/tests/test_qwen_physical_gate_harness.py"' not in value
    assert '"tools/acceptance/run-qwen-recovery-physical-gate.ps1"' not in value
    assert "              local-companion \\" not in value


def test_runtime_stable_promotion_drift_fence_matches_runtime_family_inputs():
    promote = _workflow("runtime-promote.yml")

    assert promote.count("RUNTIME_PATHS=(") == 2
    assert 'git diff --quiet "$SOURCE_SHA" HEAD -- "${RUNTIME_PATHS[@]}"' in promote
    assert 'git diff --name-only "$SOURCE_SHA" HEAD -- "${RUNTIME_PATHS[@]}"' in promote
    assert "RUNTIME_PROMOTION_RUNTIME_INPUT_DRIFT" in promote
    assert "RUNTIME_PROMOTION_FAMILY_INVALID" in promote

    required = _runtime_family_input_paths()
    missing = sorted(path for path in required if f'"{path}"' not in promote)
    assert missing == []

    # Physical acceptance and test-only evolution must not force rebuilding
    # immutable runtime bytes that have not changed.
    assert '"local-companion/tests/test_qwen_physical_gate_harness.py"' not in promote
    assert '"tools/acceptance/run-qwen-recovery-physical-gate.ps1"' not in promote
    assert "            local-companion \\" not in promote


def test_runtime_stable_promotion_requires_physical_receipt_and_reuses_release_object():
    rc = _workflow("runtime-rc.yml")
    promote = _workflow("runtime-promote.yml")

    assert "--prerelease" in rc
    assert "TDARuntime-candidate.json" in rc
    assert "docs/companion/runtime-acceptance/${RC_TAG}.json" in promote
    assert "runtime_release_evidence verify-promotion" in promote
    assert 'gh release edit "$RC_TAG"' in promote
    assert "STABLE_RELEASE_OBJECT_CHANGED" in promote
    assert "Stable runtime release already exists" in promote
    assert "assets não foram recompilados nem reenviados" in promote


def test_issue_628_production_validation_bridges_are_version_locked_and_retire_old_one_shots():
    qwen = _workflow("qwen-1012-production-validation-stable.yml")
    companion = _workflow("companion-0316-production-validation-stable.yml")

    assert not (WORKFLOWS / "qwen-1011-production-validation-stable.yml").exists()
    assert not (WORKFLOWS / "companion-0315-production-validation-stable.yml").exists()

    assert 'EXPECTED_VERSION: "1.0.12"' in qwen
    assert "eligible=false" in qwen
    assert "QWEN_PRODUCTION_VALIDATION_RUNTIME_INPUT_DRIFT" in qwen
    assert "physical_acceptance_before_promotion" in qwen
    assert "exact_rc_bytes_reused" in qwen
    assert 'gh release edit "$RC_TAG"' in qwen
    assert "QWEN_PRODUCTION_VALIDATION_STABLE_READY" in qwen

    assert 'EXPECTED_VERSION: "0.3.16"' in companion
    assert "eligible=false" in companion
    assert "COMPANION_PRODUCTION_VALIDATION_PACKAGE_INPUT_DRIFT" in companion
    assert "physical_acceptance_before_promotion" in companion
    assert "exact_rc_bytes_reused" in companion
    assert 'gh release edit "$RC_TAG"' in companion
    assert "COMPANION_PRODUCTION_VALIDATION_STABLE_READY" in companion


def test_companion_rc_keeps_manual_exact_source_artifact_recovery_path():
    value = _workflow("companion-rc.yml")

    # A completed CI rerun does not reliably emit a fresh workflow_run child.
    # Keep the explicit exact-source recovery path so an already validated
    # Companion artifact can still be promoted without rebuilding or guessing.
    assert "workflow_dispatch:" in value
    assert "source_sha:" in value
    assert "--workflow companion.yml --commit \"$SOURCE_SHA\" --status success" in value
    assert "NO_SUCCESSFUL_COMPANION_RUN_FOR_SOURCE" in value
    assert "run_started_at" in value
    assert "COMPANION_ARTIFACT_ATTEMPT_AMBIGUOUS" in value
    assert "actions/artifacts/${{ steps.artifact.outputs.artifact_id }}/zip" in value


def test_companion_synthetic_workflow_has_bounded_windows_headroom():
    value = _workflow("companion.yml")
    start = value.index("  synthetic:")
    end = value.index("\n  windows-app:", start)
    synthetic = value[start:end]

    # The Windows matrix repeatedly reached the old 10-minute job cap during
    # pytest on #628 even though the same exact suite passed on the PR head.
    # Keep a bounded but realistic budget so CI fails on tests, not scheduler load.
    assert "timeout-minutes: 20" in synthetic
