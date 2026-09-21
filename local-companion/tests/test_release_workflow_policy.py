from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"


def _read(name: str) -> str:
    return (WORKFLOWS / name).read_text(encoding="utf-8")


def test_normal_companion_ci_never_publishes_a_stable_release():
    value = _read("companion.yml")
    assert "publish-companion-release" not in value
    assert "gh release create" not in value
    assert "contents: write" not in value
    assert "TDA_BUILD_SOURCE_SHA" not in value  # one canonical source identity only
    assert "TDA_SOURCE_SHA" in value
    assert "TDACompanion-payload-manifest.json" in value
    assert "retention-days: 90" in value


def test_rc_workflow_auto_publishes_only_validated_main_artifacts_and_never_rebuilds():
    value = _read("companion-rc.yml")
    assert "workflow_dispatch:" in value
    assert "workflow_run:" in value
    assert "workflows: [CI]" in value
    assert "types: [completed]" in value
    assert "branches: [main]" in value
    assert "github.event.workflow_run.conclusion == 'success'" in value
    assert "AUTO_RC_TRIGGER_SOURCE_MISMATCH" in value
    assert "AUTO_RC_TRIGGER_NOT_MAIN_PUSH" in value
    assert "TDACompanion-windows-x64" in value
    assert "No Companion artifact" in value
    assert "gh run download" in value
    assert "candidate-manifest" in value
    assert "--source-tree-sha" in value
    assert "--payload-manifest" in value
    assert "TDACompanion-payload-manifest.json" in value
    assert "RC_RETRY_BYTES_MISMATCH" in value
    assert "--prerelease" in value
    assert "gh release create" in value
    assert "build-windows.ps1" not in value
    assert "actions/checkout@v7" not in value


def test_stable_promotion_is_manual_receipt_gated_content_equivalent_and_never_rebuilds():
    value = _read("companion-promote.yml")
    assert "workflow_dispatch:" in value
    assert "pull_request:" not in value
    assert "branches: [main, Preview]" not in value
    assert "verify-promotion" in value
    assert "docs/companion/acceptance/${RC_TAG}.json" in value
    assert "docs/companion/acceptance/${RC_TAG}.physical.json" in value
    assert "--physical-acceptance-receipt" in value
    assert "TDACompanion-physical-acceptance.json" in value
    assert "Installed acceptance receipt SHA-256" in value
    assert "ASR physical acceptance receipt SHA-256" in value
    assert "git merge-base --is-ancestor" not in value
    assert 'git fetch --no-tags origin "$SOURCE_SHA"' in value
    assert 'git diff --quiet "$SOURCE_SHA" HEAD -- local-companion' in value
    assert ".github/workflows/companion-rc.yml" in value
    assert "TDACompanion-payload-manifest.json" in value
    assert "gh release edit \"$RC_TAG\"" in value
    assert "--tag \"$STABLE_TAG\"" in value
    assert "--prerelease=false" in value
    assert "build-windows.ps1" not in value
    assert "gh release create" not in value
    assert "TDACompanion-x64.msi" not in "\n".join(
        line for line in value.splitlines() if "gh release upload" in line
    )
    assert "actions/checkout@v7" not in value


def test_stable_promotion_requires_published_runtimes_meeting_companion_minimums():
    value = _read("companion-promote.yml")
    assert "Require compatible stable runtimes" in value
    assert "MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION" in value
    assert "MIN_COMPATIBLE_QWEN_RUNTIME_VERSION" in value
    assert "companion-whisper-runtime-v" in value
    assert "companion-qwen-runtime-v" in value
    assert "COMPANION_STABLE_{family.upper()}_RUNTIME_INCOMPATIBLE" in value


def test_runtime_builds_allow_explicit_main_exact_source_dispatch():
    for name in ("whisper-runtime.yml", "qwen-runtime-package.yml"):
        value = _read(name)
        assert "workflow_dispatch:" in value
        assert "RUNTIME_MANUAL_BUILD_REQUIRES_MAIN" in value
        assert 'refs/heads/main' in value
        assert "Verify exact source checkout" in value
        assert "BUILD_SOURCE_SHA_MISMATCH" in value


def test_runtime_rc_manual_path_accepts_only_trusted_exact_source_build_events():
    value = _read("runtime-rc.yml")
    assert "workflow_dispatch:" in value
    assert "source_sha must equal current main" in value
    assert "RUNTIME_MANUAL_BUILD_EVENT_INVALID" in value
    assert "event not in {'push', 'workflow_dispatch'}" in value
    assert "AUTO_RUNTIME_TRIGGER_IDENTITY_MISMATCH:event" in value
    assert "AUTO_RUNTIME_TRIGGER_NOT_MAIN_PUSH" in value
    assert "--commit \"$SOURCE_SHA\"" in value
    assert "'head_sha': os.environ['SOURCE_SHA']" in value
    assert "'head_branch': 'main'" in value

def test_physical_recovery_can_seal_both_runtime_receipts_from_same_gpu_run():
    physical = (REPO_ROOT / "local-companion" / "packaging" / "run-physical-acceptance.ps1").read_text(
        encoding="utf-8"
    )
    recovery = (REPO_ROOT / "local-companion" / "packaging" / "run-recovery-acceptance.ps1").read_text(
        encoding="utf-8"
    )
    windows_app = (REPO_ROOT / "local-companion" / "tda_companion" / "windows_app.py").read_text(
        encoding="utf-8"
    )

    assert "WhisperRuntimeCandidateManifest" in physical
    assert "QwenRuntimeCandidateManifest" in physical
    assert '"--seal-runtime-physical"' in physical
    assert "tda_runtime_physical_acceptance_v1" in physical
    assert "contains_local_paths" in physical
    assert "RUNTIME_ACCEPTANCE_CANDIDATES_INCOMPLETE" in physical

    assert "WhisperRuntimeCandidateManifest" in recovery
    assert "QwenRuntimeCandidateManifest" in recovery
    assert "RECOVERY_RUNTIME_ACCEPTANCE_RECEIPTS_INCOMPLETE" in recovery
    assert "docs/companion/runtime-acceptance" in recovery

    assert 'mode.add_argument("--seal-runtime-physical"' in windows_app
    assert "runtime_release_evidence import RuntimeReleaseEvidenceError, main as runtime_evidence_main" in windows_app


def test_windows_build_can_fail_closed_on_authenticode_and_signs_before_hashing():
    value = (REPO_ROOT / "local-companion" / "packaging" / "build-windows.ps1").read_text(
        encoding="utf-8"
    )
    assert "[switch]$RequireAuthenticode" in value
    assert 'throw "AUTHENTICODE_REQUIRED"' in value
    assert "Get-AuthenticodeSignature" in value
    assert '"Valid"' in value
    assert "AUTHENTICODE_SIGNER_THUMBPRINT_MISMATCH" in value
    assert "AUTHENTICODE_SIGNER_SUBJECT_MISMATCH" in value
    assert "AUTHENTICODE_TIMESTAMP_MISSING" in value
    assert "AUTHENTICODE_TRUST_VERIFY_FAILED" in value
    assert "& $signToolPath verify /pa /all /v $Path" in value

    companion_sign = value.index('Invoke-AuthenticodeSign (Join-Path $appRoot "TDACompanion.exe")')
    helper_sign = value.index(
        'Invoke-AuthenticodeSign (Join-Path $appRoot "TDACompanionMaintenance.exe")'
    )
    zip_build = value.index("Compress-Archive")
    msi_sign = value.index("Invoke-AuthenticodeSign $msi")
    msi_hash = value.index("$msiHash = (Get-FileHash -Algorithm SHA256 $msi)")

    assert companion_sign < zip_build
    assert helper_sign < zip_build
    assert msi_sign < msi_hash
