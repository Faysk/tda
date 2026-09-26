from __future__ import annotations

import hashlib
import io
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from starlette.requests import Request

import tda_companion.craig as craig_module
import tda_companion.craig_ingest as ingest_module
import tda_companion.craig_runtime as runtime_module
from tda_companion.craig_ingest import (
    CraigUploadError,
    ingest_craig_file,
    ingest_craig_request,
    recover_interrupted_craig_repairs,
    remove_incomplete_craig_staging,
    remove_incomplete_craig_uploads,
)
from tda_companion.craig_runtime import load_craig_package
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    TranscriptWord,
    stats_for_tracks,
)
from tda_companion.transcription_runs import list_runs, write_completed_run


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_startup_cleanup_removes_only_owned_extracted_staging(tmp_path: Path):
    staging = tmp_path / "staging"
    staging.mkdir()
    owned = staging / (
        ".craig-" + "a" * 64 + "-" + "b" * 32 + ".partial"
    )
    unrelated = staging / ".keep.partial"
    lookalike_file = staging / (
        ".craig-" + "c" * 64 + "-" + "d" * 32 + ".partial"
    )
    owned.mkdir()
    (owned / "tracks").mkdir()
    (owned / "tracks" / "track-000001.flac").write_bytes(b"partial")
    unrelated.mkdir()
    lookalike_file.write_bytes(b"not-a-directory")

    assert remove_incomplete_craig_staging(tmp_path) == 1

    assert owned.exists() is False
    assert unrelated.is_dir()
    assert lookalike_file.read_bytes() == b"not-a-directory"


def test_startup_cleanup_removes_only_craig_upload_partials(tmp_path: Path):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    first = uploads / ("." + "a" * 32 + ".zip.partial")
    second = uploads / ("." + "b" * 32 + ".zip.partial")
    unrelated = uploads / "keep.zip.partial"
    lookalike_directory = uploads / ("." + "c" * 32 + ".zip.partial")
    first.write_bytes(b"partial-a")
    second.write_bytes(b"partial-b")
    unrelated.write_bytes(b"keep")
    lookalike_directory.mkdir()

    assert remove_incomplete_craig_uploads(tmp_path) == 2

    assert first.exists() is False
    assert second.exists() is False
    assert unrelated.read_bytes() == b"keep"
    assert lookalike_directory.is_dir()




def _flac_bytes(duration_seconds: int, sample_rate: int = 48_000) -> bytes:
    total_samples = duration_seconds * sample_rate
    packed = (
        (sample_rate & 0xFFFFF) << 44
        | (0 << 41)
        | (15 << 36)
        | (total_samples & ((1 << 36) - 1))
    )
    streaminfo = (
        (4096).to_bytes(2, "big")
        + (4096).to_bytes(2, "big")
        + (0).to_bytes(3, "big")
        + (0).to_bytes(3, "big")
        + packed.to_bytes(8, "big")
        + bytes(16)
    )
    return b"fLaC" + bytes([0x80, 0, 0, 34]) + streaminfo


def _duration_zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", _flac_bytes(300))
        archive.writestr("2-Bob.flac", _flac_bytes(180))
    return buffer.getvalue()

def _zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-alice")
        archive.writestr("2-Bob.flac", b"fLaC-bob")
    return buffer.getvalue()


def _document(package) -> TranscriptDocument:
    tracks = []
    for source in package.tracks:
        word = TranscriptWord(text="teste", start=0.0, end=0.5, confidence=0.9)
        segment = TranscriptSegment(
            id=f"{source.number}-0",
            start=0.0,
            end=0.5,
            text="teste",
            words=(word,),
        )
        tracks.append(
            TranscriptTrack(
                number=source.number,
                speaker=source.speaker,
                source_filename=source.filename,
                source_sha256=source.sha256,
                duration_seconds=1.0,
                segments=(segment,),
                timeline_offset_seconds=source.timeline_offset_seconds,
            )
        )
    value = tuple(tracks)
    return TranscriptDocument(
        recording_id=package.recording_id,
        source_sha256=package.source_sha256,
        language="pt",
        engine=TranscriptEngine(
            engine="faster-whisper",
            model="test",
            profile="whisper-turbo",
            device="cuda",
            compute_type="float16",
            alignment="native",
            model_revision="test",
        ),
        tracks=value,
        stats=stats_for_tracks(value, processing_seconds=1.0),
    )


def _request(payload: bytes) -> Request:
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": payload, "more_body": False}

    return Request({"type": "http", "method": "POST", "path": "/", "headers": []}, receive)


@pytest.mark.anyio
async def test_ingest_is_content_addressed_reusable_and_cleans_raw_zip(tmp_path: Path):
    data_root = tmp_path / "Data"
    payload = _zip_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    source_id = f"craig-{digest}"

    first = await ingest_craig_request(_request(payload), data_root)
    assert first["source_id"] == source_id
    assert first["track_count"] == 2
    assert first["reused"] is False
    assert first["source_name"] is None
    assert first["tracks"] == [
        {"number": 1, "speaker": "Alice", "size_bytes": len(b"fLaC-alice")},
        {"number": 2, "speaker": "Bob", "size_bytes": len(b"fLaC-bob")},
    ]

    package_root = data_root / "staging" / source_id
    package = load_craig_package(package_root, verify_tracks=True)
    assert package.source_sha256 == digest
    assert [track.speaker for track in package.tracks] == ["Alice", "Bob"]
    assert [track.filename for track in package.tracks] == ["1-Alice.flac", "2-Bob.flac"]
    assert [track.path for track in package.tracks] == [
        "tracks/track-000001.flac",
        "tracks/track-000002.flac",
    ]
    assert (package_root / "tracks" / "track-000001.flac").is_file()
    assert (package_root / "tracks" / "track-000002.flac").is_file()
    assert not list((data_root / "uploads").iterdir())

    second = await ingest_craig_request(_request(payload), data_root)
    assert second["source_id"] == source_id
    assert second["reused"] is True
    assert not list((data_root / "uploads").iterdir())


@pytest.mark.anyio
async def test_streamed_ingest_reuses_digest_without_rehashing_full_zip(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    payload = _zip_bytes()
    digest = hashlib.sha256(payload).hexdigest()

    monkeypatch.setattr(
        craig_module,
        "_sha256_file",
        lambda _path: (_ for _ in ()).throw(AssertionError("streamed snapshot must not be rehashed")),
    )

    result = await ingest_craig_request(_request(payload), data_root)

    assert result["source_sha256"] == digest
    assert result["source_id"] == f"craig-{digest}"
    package = load_craig_package(data_root / "staging" / result["source_id"], verify_tracks=True)
    assert package.source_sha256 == digest
    assert package.source_zip == f"craig-{digest}.zip"
    assert not list((data_root / "uploads").iterdir())


@pytest.mark.anyio
async def test_browser_ingest_finishes_heavy_staging_off_event_loop(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    payload = _zip_bytes()
    event_loop_thread = threading.get_ident()
    observed: dict[str, int] = {}
    original = ingest_module._finish_snapshot_ingest

    def wrapped(*args, **kwargs):
        observed["thread"] = threading.get_ident()
        return original(*args, **kwargs)

    monkeypatch.setattr(ingest_module, "_finish_snapshot_ingest", wrapped)

    result = await ingest_craig_request(_request(payload), data_root)

    assert result["track_count"] == 2
    assert observed["thread"] != event_loop_thread


@pytest.mark.anyio
async def test_ingest_rejects_oversize_without_leaving_partial(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    monkeypatch.setattr(ingest_module, "CRAIG_UPLOAD_MAX_BYTES", 4)

    with pytest.raises(CraigUploadError, match="CRAIG_UPLOAD_SIZE_LIMIT"):
        await ingest_craig_request(_request(b"12345"), data_root)

    assert not list((data_root / "uploads").iterdir())


def test_ingest_local_file_snapshots_reuses_and_returns_safe_session_metadata(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "minha-sessao.zip"
    source.write_bytes(_zip_bytes())

    first = ingest_craig_file(source, data_root)
    assert first["source_name"] == "minha-sessao.zip"
    assert first["track_count"] == 2
    assert [track["speaker"] for track in first["tracks"]] == ["Alice", "Bob"]
    assert first["reused"] is False
    assert "path" not in first
    assert not list((data_root / "uploads").iterdir())

    second = ingest_craig_file(source, data_root)
    assert second["source_id"] == first["source_id"]
    assert second["reused"] is True
    assert second["source_name"] == "minha-sessao.zip"
    assert not list((data_root / "uploads").iterdir())


def test_repair_is_rejected_before_reextracting_when_source_is_running(
    monkeypatch,
    tmp_path: Path,
):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao.zip"
    source.write_bytes(_zip_bytes())
    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    track = package_root / "tracks" / "track-000001.flac"
    original = track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    track.write_bytes(replacement)

    original_ingest = ingest_module.ingest_craig_zip
    calls = 0

    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original_ingest(*args, **kwargs)

    monkeypatch.setattr(ingest_module, "ingest_craig_zip", counted)

    with pytest.raises(
        CraigUploadError,
        match="CRAIG_STAGING_REPAIR_BLOCKED_BY_RUNNING_JOB",
    ):
        ingest_module._finish_snapshot_ingest(
            source,
            data_root=data_root,
            source_sha256=first["source_sha256"],
            size_bytes=source.stat().st_size,
            source_name=source.name,
            source_running=lambda source_id: source_id == first["source_id"],
        )

    assert calls == 0
    assert track.read_bytes() == replacement


def test_interrupted_repair_backup_is_restored_and_partial_is_cleaned(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao.zip"
    source.write_bytes(_zip_bytes())
    first = ingest_craig_file(source, data_root)
    staging = data_root / "staging"
    package_root = staging / first["source_id"]
    backup = staging / f".{first['source_id']}.backup-{'a' * 32}"
    partial = staging / f".{first['source_id']}.repair-{'b' * 32}.partial"

    package_root.rename(backup)
    partial.mkdir()
    (partial / "junk").write_text("partial", encoding="utf-8")

    recovered = recover_interrupted_craig_repairs(data_root)

    assert recovered == [first["source_id"]]
    assert package_root.is_dir()
    assert not backup.exists()
    assert not partial.exists()
    package = load_craig_package(package_root, verify_tracks=True)
    assert package.source_sha256 == first["source_sha256"]


def test_interrupted_repair_prefers_verified_replacement_over_corrupt_existing(
    tmp_path: Path,
):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao.zip"
    source.write_bytes(_zip_bytes())
    first = ingest_craig_file(source, data_root)

    staging = data_root / "staging"
    package_root = staging / first["source_id"]
    partial = staging / f".{first['source_id']}.repair-{'c' * 32}.partial"
    ingest_module.ingest_craig_zip(
        source,
        partial,
        source_sha256=first["source_sha256"],
        source_name=source.name,
    )

    track = package_root / "tracks" / "track-000001.flac"
    original = track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    track.write_bytes(replacement)

    recovered = recover_interrupted_craig_repairs(data_root)

    assert recovered == [first["source_id"]]
    assert package_root.is_dir()
    assert not partial.exists()
    assert track.read_bytes() == original
    assert load_craig_package(package_root, verify_tracks=True).source_sha256 == first["source_sha256"]


def test_interrupted_repair_prefers_verified_replacement_over_corrupt_backup(
    tmp_path: Path,
):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao.zip"
    source.write_bytes(_zip_bytes())
    first = ingest_craig_file(source, data_root)

    staging = data_root / "staging"
    package_root = staging / first["source_id"]
    backup = staging / f".{first['source_id']}.backup-{'a' * 32}"
    partial = staging / f".{first['source_id']}.repair-{'b' * 32}.partial"

    ingest_module.ingest_craig_zip(
        source,
        partial,
        source_sha256=first["source_sha256"],
        source_name=source.name,
    )
    package_root.rename(backup)

    corrupt_track = backup / "tracks" / "track-000001.flac"
    original = corrupt_track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    corrupt_track.write_bytes(replacement)

    recovered = recover_interrupted_craig_repairs(data_root)

    assert recovered == [first["source_id"]]
    assert package_root.is_dir()
    assert not backup.exists()
    assert not partial.exists()
    package = load_craig_package(package_root, verify_tracks=True)
    assert package.source_sha256 == first["source_sha256"]
    assert (package_root / "tracks" / "track-000001.flac").read_bytes() == original


def test_repair_promotes_and_preserves_valid_legacy_transcript(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao-legada.zip"
    source.write_bytes(_zip_bytes())

    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    package = load_craig_package(package_root, verify_tracks=True)
    legacy = package_root / "transcript.json"
    _document(package).write_atomic(legacy)
    legacy_bytes = legacy.read_bytes()

    track = package_root / "tracks" / "track-000001.flac"
    original = track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    track.write_bytes(replacement)

    repaired = ingest_craig_file(source, data_root)

    assert repaired["reused"] is False
    assert track.read_bytes() == original
    runs = list_runs(package_root, verify_content=True)
    assert len(runs) == 1
    assert runs[0]["origin"] == "legacy_transcript_v1"
    assert (package_root / "runs" / runs[0]["run_id"] / "transcript.json").read_bytes() == legacy_bytes
    assert legacy.read_bytes() == legacy_bytes


def test_repair_preserves_invalid_root_without_manufacturing_completed_run(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "session.zip"
    source.write_bytes(_zip_bytes())
    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    root = package_root / "transcript.json"
    original = b'{"incomplete":"historical evidence"}'
    root.write_bytes(original)
    (package_root / "tracks" / "track-000001.flac").write_bytes(b"corrupt")
    repaired = ingest_craig_file(source, data_root)
    assert repaired["reused"] is False
    assert root.read_bytes() == original
    assert list_runs(package_root) == []
    load_craig_package(package_root, verify_tracks=True)


def test_startup_classifies_once_and_recovers_missing_projection(monkeypatch, tmp_path: Path):
    import tda_companion.transcription_runs as runs
    data_root = tmp_path / "Data"
    source = tmp_path / "session.zip"
    source.write_bytes(_zip_bytes())
    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    document = _document(load_craig_package(package_root))
    document.write_atomic(package_root / "transcript.json")
    assert runs.maintain_legacy_transcripts(data_root) == {"preserved": 1, "invalid_preserved": 0, "failed": 0}
    original = runs._bounded_transcript
    def no_content(*args):
        pytest.fail("known source reread during maintenance")
    monkeypatch.setattr(runs, "_bounded_transcript", no_content)
    assert runs.maintain_legacy_transcripts(data_root) == {"preserved": 0, "invalid_preserved": 0, "failed": 0}
    monkeypatch.setattr(runs, "_bounded_transcript", original)
    (package_root / "root-transcript-state.json").unlink()
    assert runs.maintain_legacy_transcripts(data_root)["preserved"] == 1
    assert len(list_runs(package_root)) == 1
    (package_root / "transcript.json").write_bytes(b"invalid legacy")
    assert runs.maintain_legacy_transcripts(data_root)["invalid_preserved"] == 1
    assert (package_root / "transcript.json").read_bytes() == b"invalid legacy"


def test_reupload_repairs_corrupt_staging_preserves_runs_and_discards_checkpoints(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao.zip"
    payload = _zip_bytes()
    source.write_bytes(payload)

    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    track = package_root / "tracks" / "track-000001.flac"
    package = load_craig_package(package_root, verify_tracks=True)
    manifest = write_completed_run(
        package_root,
        _document(package),
        job_id="repair-valid-run",
        attempt=1,
    )

    original = track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    track.write_bytes(replacement)
    invalid_run = package_root / "runs" / "run-invalid-a1"
    invalid_run.mkdir(parents=True)
    (invalid_run / "keep.txt").write_text("must-not-survive", encoding="utf-8")
    stale_checkpoint = package_root / ".checkpoints" / "stale"
    stale_checkpoint.mkdir(parents=True)
    (stale_checkpoint / "track.json").write_text("stale", encoding="utf-8")

    repaired = ingest_craig_file(source, data_root)

    assert repaired["source_id"] == first["source_id"]
    assert repaired["reused"] is False
    assert track.read_bytes() == original
    assert (package_root / "runs" / manifest["run_id"] / "run.json").is_file()
    assert not (package_root / "runs" / "run-invalid-a1").exists()
    assert {run["run_id"] for run in list_runs(package_root, verify_content=True)} == {
        manifest["run_id"]
    }
    assert not (package_root / ".checkpoints").exists()
    package = load_craig_package(package_root, verify_tracks=True)
    assert package.source_sha256 == first["source_sha256"]


def test_repair_copies_run_history_only_while_source_gate_is_held(
    monkeypatch,
    tmp_path: Path,
):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao-gated.zip"
    source.write_bytes(_zip_bytes())
    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]

    package = load_craig_package(package_root, verify_tracks=True)
    write_completed_run(
        package_root,
        _document(package),
        job_id="gated-run",
        attempt=1,
    )
    track = package_root / "tracks" / "track-000001.flac"
    original = track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    track.write_bytes(replacement)

    class Gate:
        held = False

        def __enter__(self):
            self.held = True
            return self

        def __exit__(self, *_args):
            self.held = False
            return False

    gate = Gate()
    original_copy = ingest_module._copy_run_history
    observed = {"called": False}

    def guarded_copy(*args, **kwargs):
        assert gate.held is True
        observed["called"] = True
        return original_copy(*args, **kwargs)

    monkeypatch.setattr(ingest_module, "_copy_run_history", guarded_copy)

    repaired = ingest_module._finish_snapshot_ingest(
        source,
        data_root=data_root,
        source_sha256=first["source_sha256"],
        size_bytes=source.stat().st_size,
        source_name=source.name,
        source_gate=gate,
        source_running=lambda _source_id: False,
    )

    assert repaired["reused"] is False
    assert observed["called"] is True
    assert track.read_bytes() == original
    assert list_runs(package_root, verify_content=True)


def test_concurrent_reupload_converges_on_one_repaired_source(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao-concorrente.zip"
    source.write_bytes(_zip_bytes())

    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    track = package_root / "tracks" / "track-000001.flac"
    package = load_craig_package(package_root, verify_tracks=True)
    manifest = write_completed_run(
        package_root,
        _document(package),
        job_id="concurrent-valid-run",
        attempt=1,
    )

    original = track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    track.write_bytes(replacement)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(ingest_craig_file, source, data_root),
            executor.submit(ingest_craig_file, source, data_root),
        ]
        results = [future.result(timeout=10) for future in futures]

    assert {result["source_id"] for result in results} == {first["source_id"]}
    assert sorted(result["reused"] for result in results) == [False, True]
    assert track.read_bytes() == original
    assert (package_root / "runs" / manifest["run_id"] / "run.json").is_file()
    assert {run["run_id"] for run in list_runs(package_root, verify_content=True)} == {
        manifest["run_id"]
    }
    load_craig_package(package_root, verify_tracks=True)


def test_reupload_of_sealed_source_does_not_rehash_all_tracks(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao.zip"
    source.write_bytes(_zip_bytes())

    first = ingest_craig_file(source, data_root)
    assert first["reused"] is False

    monkeypatch.setattr(
        runtime_module,
        "_sha256_file",
        lambda _path: (_ for _ in ()).throw(
            AssertionError("sealed source reuse must stay on the metadata fast path")
        ),
    )

    second = ingest_craig_file(source, data_root)

    assert second["source_id"] == first["source_id"]
    assert second["reused"] is True


def test_ingest_decouples_windows_unsafe_speaker_name_from_physical_filename(tmp_path: Path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('1-Alice:Boss?.flac', b"fLaC-special")
    source = tmp_path / "special.zip"
    source.write_bytes(buffer.getvalue())
    data_root = tmp_path / "Data"

    result = ingest_craig_file(source, data_root)
    package = load_craig_package(data_root / "staging" / result["source_id"], verify_tracks=True)

    assert package.tracks[0].speaker == "Alice:Boss?"
    assert package.tracks[0].filename == "1-Alice:Boss?.flac"
    assert package.tracks[0].path == "tracks/track-000001.flac"
    assert (data_root / "staging" / result["source_id"] / "tracks" / "track-000001.flac").is_file()


def test_ingest_local_file_requires_zip_extension(tmp_path: Path):
    source = tmp_path / "sessao.flac"
    source.write_bytes(b"fLaC")

    with pytest.raises(CraigUploadError, match="CRAIG_ZIP_REQUIRED"):
        ingest_craig_file(source, tmp_path / "Data")


@pytest.mark.anyio
async def test_ingest_reports_chronological_duration_and_total_audio_work(tmp_path: Path):
    data_root = tmp_path / "Data"
    result = await ingest_craig_request(_request(_duration_zip_bytes()), data_root)

    assert result["track_count"] == 2
    assert result["session_duration_seconds"] == 300.0
    assert result["audio_work_seconds"] == 480.0

    package = load_craig_package(
        data_root / "staging" / result["source_id"],
        verify_tracks=False,
    )
    assert [track.duration_seconds for track in package.tracks] == [300.0, 180.0]

    reused = await ingest_craig_request(_request(_duration_zip_bytes()), data_root)
    assert reused["reused"] is True
    assert reused["session_duration_seconds"] == 300.0
    assert reused["audio_work_seconds"] == 480.0


@pytest.mark.anyio
async def test_ingest_keeps_duration_unknown_for_legacy_or_invalid_flac_metadata(tmp_path: Path):
    result = await ingest_craig_request(_request(_zip_bytes()), tmp_path / "Data")

    assert result["session_duration_seconds"] is None
    assert result["audio_work_seconds"] is None


@pytest.mark.parametrize("cached", [999, "garbage", -1, float("nan"), float("inf"), True, None])
def test_factual_duration_ignores_optional_cache_without_manifest_rewrite(tmp_path, cached):
    import json
    source = tmp_path / "session.zip"
    source.write_bytes(_duration_zip_bytes())
    data_root = tmp_path / "Data"
    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    path = package_root / "manifest.json"
    manifest = json.loads(path.read_bytes())
    for item in manifest["tracks"]:
        item["duration_seconds"] = cached
    manifest["tracks"][1]["timeline_offset_seconds"] = 240
    original = json.dumps(manifest).encode()
    path.write_bytes(original)
    reused = ingest_craig_file(source, data_root)
    assert reused["reused"] is True
    assert reused["audio_work_seconds"] == 480
    assert reused["session_duration_seconds"] == 420
    assert reused["source_sha256"] == first["source_sha256"]
    assert path.read_bytes() == original


def test_one_unavailable_duration_keeps_both_aggregates_unknown(tmp_path):
    import json
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("1-Alice.flac", _flac_bytes(60))
        archive.writestr("2-Bob.flac", b"fLaC-legacy")
    source = tmp_path / "session.zip"
    source.write_bytes(buffer.getvalue())
    data_root = tmp_path / "Data"
    first = ingest_craig_file(source, data_root)
    path = data_root / "staging" / first["source_id"] / "manifest.json"
    manifest = json.loads(path.read_bytes())
    manifest["tracks"][1]["duration_seconds"] = 30
    path.write_text(json.dumps(manifest))
    reused = ingest_craig_file(source, data_root)
    assert reused["audio_work_seconds"] is None
    assert reused["session_duration_seconds"] is None
