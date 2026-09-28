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
    assert "run_started_at" in value
    assert "COMPANION_ARTIFACT_ATTEMPT_AMBIGUOUS" in value
    assert "artifact_id=$ARTIFACT_ID" in value
    assert "actions/artifacts/${{ steps.artifact.outputs.artifact_id }}/zip" in value
    assert "candidate-manifest" in value
    assert "--source-tree-sha" in value
    assert "--payload-manifest" in value
    assert "TDACompanion-payload-manifest.json" in value
    assert "RC_RETRY_BYTES_MISMATCH" in value
    assert "--prerelease" in value
    assert "gh release create" in value
    assert "build-windows.ps1" not in value
    assert "actions/checkout@v7" not in value


def test_0316_production_validation_bridge_noops_when_successful_rc_run_published_no_release():
    value = _read("companion-0316-production-validation-stable.yml")
    assert 'RC_TAG="companion-rc-v${VERSION}-${SOURCE_SHA:0:12}"' in value
    assert 'gh release view "$RC_TAG" --repo "$GITHUB_REPOSITORY"' in value
    assert 'echo "eligible=false" >> "$GITHUB_OUTPUT"' in value
    assert "Stable bridge is a no-op" in value
    assert "Verify immutable RC release and bytes" in value
    assert "if: steps.release.outputs.eligible == 'true'" in value


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
    assert "COMPANION_PATHS=(" in value
    assert 'git diff --quiet "$SOURCE_SHA" HEAD -- "${COMPANION_PATHS[@]}"' in value
    assert "COMPANION_PROMOTION_PACKAGE_INPUT_DRIFT" in value
    for path in (
        ".github/workflows/companion.yml",
        "local-companion/pyproject.toml",
        "local-companion/requirements-test.lock",
        "local-companion/tda_companion/**",
        "local-companion/packaging/**",
    ):
        assert f'"{path}"' in value
    assert '"local-companion/tests/**"' not in value
    assert '"tools/acceptance/**"' not in value
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


def test_stable_promotion_verifies_canonical_web_manifest_and_download_redirects():
    value = _read("companion-promote.yml")

    assert "Verify canonical Web resolves promoted Stable" in value
    # The executable smoke is tested with a fake transport in
    # test_canonical_release_smoke.py, including the exact URL actually requested.
    assert 'manifest_url = f"{base}/api/downloads/companion/windows/manifest"' in value
    assert "CANONICAL_WEB_STABLE_MANIFEST_MISMATCH" in value
    assert "CANONICAL_WEB_STABLE_REDIRECT_MISMATCH" in value
    assert "CANONICAL_WEB_STABLE_VERIFIED" in value
    assert 'value.get("channel") == "stable"' in value
    assert 'asset.get("sha256") == expected_sha' in value
    assert 'asset.get("size") == expected_size' in value
    assert 'for suffix in ("", f"?tag={tag}")' in value


def test_stable_promotion_requires_the_exact_physically_accepted_runtime_versions():
    value = _read("companion-promote.yml")
    assert "Require the exact physically accepted Stable runtime set" in value
    assert "RC_WHISPER_VERSION" in value
    assert "RC_QWEN_VERSION" in value
    assert "companion-whisper-runtime-v" in value
    assert "companion-qwen-runtime-v" in value
    assert "COMPANION_STABLE_{family.upper()}_RUNTIME_NOT_PHYSICALLY_ACCEPTED" in value
    assert "latest != expected" in value
    assert "STABLE_RUNTIME_PHYSICAL_IDENTITY_OK" in value


def test_runtime_builds_allow_explicit_main_exact_source_dispatch():
    for name in ("whisper-runtime.yml", "qwen-runtime-package.yml"):
        value = _read(name)
        assert "workflow_dispatch:" in value
        assert "RUNTIME_MANUAL_BUILD_REQUIRES_MAIN" in value
        assert 'refs/heads/main' in value
        assert "Verify exact source checkout" in value
        assert "BUILD_SOURCE_SHA_MISMATCH" in value


def test_qwen_package_dispatches_exact_main_source_to_runtime_rc_without_duplicate_workflow_run_trigger():
    package = _read("qwen-runtime-package.yml")
    runtime_rc = _read("runtime-rc.yml")

    assert "dispatch-runtime-rc:" in package
    assert "needs: package" in package
    assert "needs.package.result == 'success'" in package
    assert "github.event_name == 'push'" in package
    assert "github.ref == 'refs/heads/main'" in package
    assert "actions: write" in package
    assert "gh workflow run runtime-rc.yml" in package
    assert "-f family=qwen" in package
    assert '-f source_sha="$GITHUB_SHA"' in package
    assert "QWEN_RUNTIME_RC_DISPATCHED" in package

    workflow_run_section = runtime_rc.split("workflow_run:", 1)[1].split("permissions:", 1)[0]
    assert "workflows: [Whisper Runtime]" in workflow_run_section
    assert "Qwen Runtime Package" not in workflow_run_section


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


def test_production_deploy_has_no_retired_statistics_rollout_flag():
    value = _read("production-cd.yml")
    assert "TDA_STATS_READ_MODEL_V2_ENABLED" not in value

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
    assert '[ValidateSet("none", "certificate-store", "artifact-signing")]' in value
    assert '[string]$AuthenticodeProvider = "certificate-store"' in value
    assert "[switch]$RequireAuthenticode" in value
    assert 'throw "AUTHENTICODE_REQUIRED"' in value
    assert 'throw "AUTHENTICODE_TIMESTAMP_REQUIRED"' in value
    assert 'throw "AUTHENTICODE_EXPECTED_SUBJECT_REQUIRED"' in value
    assert "AUTHENTICODE_PROVIDER_ARGUMENT_CONFLICT" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_THUMBPRINT_UNSUPPORTED" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_DLIB_REQUIRED" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_REQUIRED" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_KEY_INVALID" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_SIGNTOOL_TOO_OLD" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_ENDPOINT_INVALID" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_ACCOUNT_INVALID" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_EXCLUDE_CREDENTIALS_INVALID" in value
    assert '"EnvironmentCredential"' in value
    assert '$rawExcluded -is [string]' in value
    assert '$rawExcluded -isnot [Collections.IEnumerable]' in value
    assert "codesigning\\.azure\\.net" in value
    assert '[Version]"10.0.2261.755"' in value
    assert '"/dlib", $artifactSigningDlibPath' in value
    assert '"/dmdf", $artifactSigningMetadataPath' in value
    assert "Invoke-Expression" not in value
    assert "Get-AuthenticodeSignature" in value
    assert '"Valid"' in value
    assert "AUTHENTICODE_SIGNER_THUMBPRINT_MISMATCH" in value
    assert "AUTHENTICODE_SIGNER_SUBJECT_MISMATCH" in value
    assert "AUTHENTICODE_TIMESTAMP_MISSING" in value
    assert "AUTHENTICODE_TRUST_VERIFY_FAILED" in value
    assert "& $signToolPath verify /pa /all /v $Path" in value

    # Fixed thumbprint remains a certificate-store identity check only. Managed
    # Artifact Signing uses short-lived leaf certificates and is bound through
    # the typed provider metadata + stable expected subject/trust/timestamp.
    assert "if ($certificateStoreEnabled -and $actualThumbprint -ne $normalizedThumbprint)" in value

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

def test_acceptance_powershell_does_not_write_automatic_variables():
    import re

    automatic = (
        "args",
        "error",
        "foreach",
        "home",
        "host",
        "input",
        "matches",
        "pid",
        "profile",
        "pwd",
        "switch",
    )
    names = "|".join(re.escape(name) for name in automatic)
    assignment = re.compile(rf"(?i)^\s*\$(?:{names})\s*=")
    foreach_binding = re.compile(rf"(?i)\bforeach\s*\(\s*\$(?:{names})\b")
    typed_parameter = re.compile(rf"(?i)\[[^\]\r\n]+\]\s*\$(?:{names})\b")

    scripts = sorted(
        (REPO_ROOT / "local-companion" / "packaging").glob("*.ps1")
    ) + sorted((REPO_ROOT / "tools" / "acceptance").glob("*.ps1"))

    violations: list[str] = []
    for script in scripts:
        for number, line in enumerate(script.read_text(encoding="utf-8").splitlines(), start=1):
            if assignment.search(line) or foreach_binding.search(line) or typed_parameter.search(line):
                violations.append(f"{script.relative_to(REPO_ROOT)}:{number}:{line.strip()}")

    assert violations == []

def test_companion_windows_job_parses_the_build_harness_before_packaging():
    value = _read("companion.yml")
    parser_block = value[value.index("Validate PowerShell harness syntax"):value.index("Install WiX Toolset 5")]
    assert '"local-companion/packaging/build-windows.ps1"' in parser_block

def test_companion_windows_job_executes_signing_fail_closed_probes():
    value = _read("companion.yml")
    assert "Validate signing provider fail-closed contracts" in value
    assert "AUTHENTICODE_REQUIRED" in value
    assert "AUTHENTICODE_THUMBPRINT_INVALID" in value
    assert "AUTHENTICODE_ARTIFACT_SIGNING_DLIB_REQUIRED" in value
    assert "Assert-BuildFails" in value

