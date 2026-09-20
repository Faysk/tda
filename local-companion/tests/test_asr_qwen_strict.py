from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from tda_companion.asr_models import get_profile
from tda_companion.asr_qwen import (
    AudioWindow,
    QWEN_WINDOW_SECONDS,
    QwenRuntimeError,
    _runtime_fingerprint,
)
from tda_companion.asr_qwen_strict import (
    QWEN_WINDOW_OVERLAP_SECONDS,
    _owned_words,
    transcribe_craig_package_qwen_strict,
)
from tda_companion.craig import CraigPackage, CraigPackageError, CraigTrack
from tda_companion.qwen_acceptance import QwenPlan
from tda_companion.transcript import TranscriptWord


def _package(tmp_path: Path) -> tuple[CraigPackage, Path]:
    root = tmp_path / "Data" / "staging" / "strict"
    tracks = root / "tracks"
    tracks.mkdir(parents=True)
    source = tracks / "1-Alice.flac"
    source.write_bytes(b"audio")
    track = CraigTrack(
        number=1,
        speaker="Alice",
        filename="1-Alice.flac",
        path="tracks/1-Alice.flac",
        size_bytes=5,
        sha256="1" * 64,
        identity=None,
    )
    return (
        CraigPackage(
            schema_version="tda_craig_package_v1",
            source_zip="fixture.zip",
            source_sha256="a" * 64,
            recording_id="strict",
            guild=None,
            channel=None,
            requester=None,
            start_time=None,
            tracks=(track,),
            info_present=False,
            raw_dat_present=False,
        ),
        root,
    )


def _two_track_package(tmp_path: Path) -> tuple[CraigPackage, Path]:
    root = tmp_path / "Data" / "staging" / "strict-two"
    tracks_root = root / "tracks"
    tracks_root.mkdir(parents=True)
    tracks = []
    for number, speaker in ((1, "Alice"), (2, "Bob")):
        filename = f"{number}-{speaker}.flac"
        payload = f"audio-{speaker}".encode("utf-8")
        (tracks_root / filename).write_bytes(payload)
        tracks.append(
            CraigTrack(
                number=number,
                speaker=speaker,
                filename=filename,
                path=f"tracks/{filename}",
                size_bytes=len(payload),
                sha256=hashlib.sha256(payload).hexdigest(),
                identity=None,
            )
        )
    return (
        CraigPackage(
            schema_version="tda_craig_package_v1",
            source_zip="fixture-two.zip",
            source_sha256="b" * 64,
            recording_id="strict-two",
            guild=None,
            channel=None,
            requester=None,
            start_time=None,
            tracks=tuple(tracks),
            info_present=False,
            raw_dat_present=False,
        ),
        root,
    )


def _plan(_profile_id: str) -> QwenPlan:
    return QwenPlan(profile_id="qwen-fast", device="cuda", dtype="bfloat16", compute_capability="8.9")


def _model_prepare(_models_root: Path, profile):
    assert profile == get_profile("qwen-fast")
    return Path("model")


def _aligner_prepare(_models_root: Path):
    return Path("aligner")


def _two_windows(_path: Path):
    stride = QWEN_WINDOW_SECONDS - QWEN_WINDOW_OVERLAP_SECONDS
    yield AudioWindow(index=1, start=0.0, end=QWEN_WINDOW_SECONDS, audio="w1")
    yield AudioWindow(index=2, start=stride, end=stride + 46.0, audio="w2")


def test_qwen_checkpoint_pipeline_revision_is_explicit():
    assert "checkpoint=qwen-track-v2" in _runtime_fingerprint()


def test_strict_qwen_reports_runtime_validation_before_cuda_plan_resolution(
    tmp_path: Path,
):
    package, root = _package(tmp_path)
    reports: list[dict] = []

    def plan(profile_id: str) -> QwenPlan:
        assert reports[-1] == {
            "type": "stage",
            "stage": "runtime_validation",
            "profile": profile_id,
        }
        raise QwenRuntimeError("TEST_STOP_AFTER_RUNTIME_VALIDATION")

    with pytest.raises(QwenRuntimeError, match="TEST_STOP_AFTER_RUNTIME_VALIDATION"):
        transcribe_craig_package_qwen_strict(
            package,
            root,
            tmp_path / "Models",
            profile_id="qwen-fast",
            checkpoints=False,
            report=reports.append,
            plan_resolver=plan,
        )

    assert reports == [
        {
            "type": "stage",
            "stage": "runtime_validation",
            "profile": "qwen-fast",
        }
    ]


def test_strict_qwen_accepts_silent_window_without_alignment(tmp_path: Path):
    package, root = _package(tmp_path)
    align_calls = 0

    class Asr:
        def transcribe(self, _audio, *, prompt: str):
            return "   ", "Portuguese"
        def close(self):
            pass

    class Aligner:
        def align(self, _audio, _text: str, _language: str):
            nonlocal align_calls
            align_calls += 1
            raise AssertionError("silent windows must not reach forced alignment")
        def close(self):
            pass

    document = transcribe_craig_package_qwen_strict(
        package,
        root,
        tmp_path / "Models",
        profile_id="qwen-fast",
        checkpoints=False,
        plan_resolver=_plan,
        model_prepare=_model_prepare,
        aligner_prepare=_aligner_prepare,
        asr_session_factory=lambda _root, _plan: Asr(),
        aligner_session_factory=lambda _root, _plan: Aligner(),
        window_reader=lambda _path: iter(
            [AudioWindow(index=1, start=0.0, end=2.0, audio="silence")]
        ),
        energy_reader=lambda *_args: -120.0,
    )

    assert align_calls == 0
    assert len(document.tracks) == 1
    assert document.tracks[0].segments == ()
    assert document.stats.segment_count == 0
    assert document.stats.word_count == 0


def test_strict_qwen_fails_instead_of_publishing_window_fallback(tmp_path: Path):
    package, root = _package(tmp_path)

    class Asr:
        def transcribe(self, _audio, *, prompt: str):
            return "texto", "Portuguese"
        def close(self):
            pass

    class BrokenAligner:
        def align(self, _audio, _text: str, _language: str):
            raise QwenRuntimeError("QWEN_ALIGNMENT_FAILED")
        def close(self):
            pass

    with pytest.raises(QwenRuntimeError, match="QWEN_ALIGNMENT_REQUIRED"):
        transcribe_craig_package_qwen_strict(
            package,
            root,
            tmp_path / "Models",
            profile_id="qwen-fast",
            checkpoints=False,
            plan_resolver=_plan,
            model_prepare=_model_prepare,
            aligner_prepare=_aligner_prepare,
            asr_session_factory=lambda _root, _plan: Asr(),
            aligner_session_factory=lambda _root, _plan: BrokenAligner(),
            window_reader=_two_windows,
        )


def test_strict_qwen_reuses_prealignment_text_after_aligner_failure(tmp_path: Path):
    package, root = _two_track_package(tmp_path)
    asr_calls = 0
    first_reports: list[dict] = []
    second_reports: list[dict] = []

    def reader(path: Path):
        yield AudioWindow(index=1, start=0.0, end=2.0, audio=path.name)

    class Asr:
        def transcribe(self, audio, *, prompt: str):
            nonlocal asr_calls
            asr_calls += 1
            return f"texto {audio}", "Portuguese"

        def close(self):
            pass

    class BrokenAligner:
        def align(self, _audio, _text: str, _language: str):
            raise QwenRuntimeError("QWEN_ALIGNMENT_FAILED")

        def close(self):
            pass

    with pytest.raises(QwenRuntimeError, match="QWEN_ALIGNMENT_REQUIRED"):
        transcribe_craig_package_qwen_strict(
            package,
            root,
            tmp_path / "Models",
            profile_id="qwen-fast",
            plan_resolver=_plan,
            model_prepare=_model_prepare,
            aligner_prepare=_aligner_prepare,
            asr_session_factory=lambda _root, _plan: Asr(),
            aligner_session_factory=lambda _root, _plan: BrokenAligner(),
            window_reader=reader,
            report=first_reports.append,
        )

    assert asr_calls == 2
    text_checkpoints = list(
        root.glob(".checkpoints/*/qwen-text-v1/track-*.json")
    )
    assert len(text_checkpoints) == 2
    assert list(root.glob(".checkpoints/*/track-*.json")) == []
    assert sum(
        item.get("code") == "ASR_TEXT_CHECKPOINT_SAVED"
        for item in first_reports
    ) == 2

    def forbidden(*_args, **_kwargs):
        raise AssertionError("retry must reuse durable Qwen text instead of loading ASR")

    with pytest.raises(QwenRuntimeError, match="QWEN_ALIGNMENT_REQUIRED"):
        transcribe_craig_package_qwen_strict(
            package,
            root,
            tmp_path / "Models",
            profile_id="qwen-fast",
            plan_resolver=_plan,
            model_prepare=forbidden,
            aligner_prepare=_aligner_prepare,
            asr_session_factory=forbidden,
            aligner_session_factory=lambda _root, _plan: BrokenAligner(),
            window_reader=reader,
            report=second_reports.append,
        )

    assert asr_calls == 2
    assert sum(
        item.get("code") == "ASR_TEXT_CHECKPOINT_REUSED"
        for item in second_reports
    ) == 2
    stages = [
        item.get("stage")
        for item in second_reports
        if item.get("type") == "stage"
    ]
    assert "model_prepare" not in stages
    assert "model_load" not in stages
    assert "transcription" not in stages
    assert "alignment" in stages


def test_strict_qwen_refuses_text_reuse_if_staged_track_bytes_changed(tmp_path: Path):
    package, root = _two_track_package(tmp_path)

    def reader(path: Path):
        yield AudioWindow(index=1, start=0.0, end=2.0, audio=path.name)

    class Asr:
        def transcribe(self, audio, *, prompt: str):
            return f"texto {audio}", "Portuguese"

        def close(self):
            pass

    class BrokenAligner:
        def align(self, _audio, _text: str, _language: str):
            raise QwenRuntimeError("QWEN_ALIGNMENT_FAILED")

        def close(self):
            pass

    with pytest.raises(QwenRuntimeError, match="QWEN_ALIGNMENT_REQUIRED"):
        transcribe_craig_package_qwen_strict(
            package,
            root,
            tmp_path / "Models",
            profile_id="qwen-fast",
            plan_resolver=_plan,
            model_prepare=_model_prepare,
            aligner_prepare=_aligner_prepare,
            asr_session_factory=lambda _root, _plan: Asr(),
            aligner_session_factory=lambda _root, _plan: BrokenAligner(),
            window_reader=reader,
        )

    changed = root / package.tracks[0].path
    original = changed.read_bytes()
    changed.write_bytes(b"X" + original[1:])
    assert changed.stat().st_size == package.tracks[0].size_bytes

    with pytest.raises(CraigPackageError, match="CRAIG_MANIFEST_TRACK_HASH_MISMATCH"):
        transcribe_craig_package_qwen_strict(
            package,
            root,
            tmp_path / "Models",
            profile_id="qwen-fast",
            plan_resolver=_plan,
            model_prepare=lambda *_args: (_ for _ in ()).throw(
                AssertionError("changed source must fail before model load")
            ),
            aligner_prepare=_aligner_prepare,
            asr_session_factory=lambda *_args: (_ for _ in ()).throw(
                AssertionError("changed source must not reach ASR")
            ),
            aligner_session_factory=lambda _root, _plan: BrokenAligner(),
            window_reader=reader,
        )


def test_strict_qwen_corrupt_text_checkpoint_retranscribes_only_that_track(
    tmp_path: Path,
):
    package, root = _two_track_package(tmp_path)
    asr_calls = 0

    def reader(path: Path):
        yield AudioWindow(index=1, start=0.0, end=2.0, audio=path.name)

    class Asr:
        def transcribe(self, audio, *, prompt: str):
            nonlocal asr_calls
            asr_calls += 1
            return f"texto {audio}", "Portuguese"

        def close(self):
            pass

    class BrokenAligner:
        def align(self, _audio, _text: str, _language: str):
            raise QwenRuntimeError("QWEN_ALIGNMENT_FAILED")

        def close(self):
            pass

    def attempt():
        with pytest.raises(QwenRuntimeError, match="QWEN_ALIGNMENT_REQUIRED"):
            transcribe_craig_package_qwen_strict(
                package,
                root,
                tmp_path / "Models",
                profile_id="qwen-fast",
                plan_resolver=_plan,
                model_prepare=_model_prepare,
                aligner_prepare=_aligner_prepare,
                asr_session_factory=lambda _root, _plan: Asr(),
                aligner_session_factory=lambda _root, _plan: BrokenAligner(),
                window_reader=reader,
            )

    attempt()
    assert asr_calls == 2
    checkpoints = sorted(root.glob(".checkpoints/*/qwen-text-v1/track-*.json"))
    assert len(checkpoints) == 2
    checkpoints[0].write_text("{broken", encoding="utf-8")

    attempt()
    assert asr_calls == 3


def test_overlap_ownership_assigns_boundary_words_once():
    overlap = QWEN_WINDOW_OVERLAP_SECONDS
    stride = QWEN_WINDOW_SECONDS - overlap
    first = AudioWindow(index=1, start=0.0, end=QWEN_WINDOW_SECONDS, audio=None)
    second = AudioWindow(index=2, start=stride, end=stride + 46.0, audio=None)
    boundary = stride + overlap / 2.0
    words = [
        TranscriptWord(text="left", start=boundary - 1.0, end=boundary - 0.2),
        TranscriptWord(text="right", start=boundary + 0.2, end=boundary + 1.0),
    ]

    owned_first = _owned_words(words, first, first=True, last=False, overlap_seconds=overlap)
    owned_second = _owned_words(words, second, first=False, last=True, overlap_seconds=overlap)

    assert [word.text for word in owned_first] == ["left"]
    assert [word.text for word in owned_second] == ["right"]
    assert {word.text for word in owned_first}.isdisjoint({word.text for word in owned_second})


def test_strict_qwen_replays_windows_in_lockstep_not_full_track_dict(
    monkeypatch,
    tmp_path: Path,
):
    monkeypatch.setenv("TDA_ASR_RUNTIME_VERSION", "1.0.6")
    package, root = _package(tmp_path)
    reads = 0
    align_calls: list[str] = []
    reports: list[dict] = []

    def reader(_path: Path):
        nonlocal reads
        reads += 1
        yield AudioWindow(index=1, start=0.0, end=2.0, audio=f"pass-{reads}-one")
        yield AudioWindow(index=2, start=1.5, end=3.0, audio=f"pass-{reads}-two")

    class Asr:
        def transcribe(self, audio, *, prompt: str):
            return f"texto {audio[-3:]}", "Portuguese"
        def close(self):
            pass

    class Aligner:
        def align(self, audio, text: str, _language: str):
            align_calls.append(audio)
            if audio.endswith("one"):
                return [{"text": "um", "start_time": 0.1, "end_time": 0.4}]
            return [{"text": "dois", "start_time": 0.7, "end_time": 1.0}]
        def close(self):
            pass

    document = transcribe_craig_package_qwen_strict(
        package,
        root,
        tmp_path / "Models",
        profile_id="qwen-fast",
        checkpoints=False,
        plan_resolver=_plan,
        model_prepare=_model_prepare,
        aligner_prepare=_aligner_prepare,
        asr_session_factory=lambda _root, _plan: Asr(),
        aligner_session_factory=lambda _root, _plan: Aligner(),
        window_reader=reader,
        energy_reader=lambda *_args: -10.0,
        report=reports.append,
    )

    assert [
        item
        for item in reports
        if item.get("type") == "progress"
    ] == [
        {
            "type": "progress",
            "completed": 1,
            "total": 1,
            "unit": "tracks",
            "stage": "alignment",
        }
    ]
    assert any(
        item.get("type") == "event"
        and item.get("code") == "TRACK_STARTED"
        and item.get("track") == 1
        and item.get("total_tracks") == 1
        and item.get("speaker") == "Alice"
        for item in reports
    )
    assert any(
        item.get("type") == "event"
        and item.get("code") == "TRACK_COMPLETED"
        and item.get("track") == 1
        for item in reports
    )

    stages = [item.get("stage") for item in reports if item.get("type") == "stage"]
    assert "energy_analysis" not in stages
    assert stages.index("alignment") < stages.index("cross_track_dedup")

    # Fresh tracks reuse the alignment windows for dedup energy, so production
    # decodes each track only for ASR + alignment instead of a third energy pass.
    assert reads == 2
    assert align_calls == ["pass-2-one", "pass-2-two"]
    assert "strict-overlap-v2" in document.engine.alignment
    assert document.warnings == ()


def test_strict_qwen_checkpoint_reuse_skips_model_and_only_replays_energy(
    monkeypatch,
    tmp_path: Path,
):
    monkeypatch.setenv("TDA_ASR_RUNTIME_VERSION", "1.0.6")
    package, root = _package(tmp_path)
    reads = 0

    def reader(_path: Path):
        nonlocal reads
        reads += 1
        yield AudioWindow(index=1, start=0.0, end=2.0, audio=f"pass-{reads}")

    class Asr:
        def transcribe(self, _audio, *, prompt: str):
            return "texto", "Portuguese"
        def close(self):
            pass

    class Aligner:
        def align(self, _audio, _text: str, _language: str):
            return [{"text": "texto", "start_time": 0.1, "end_time": 0.5}]
        def close(self):
            pass

    first = transcribe_craig_package_qwen_strict(
        package,
        root,
        tmp_path / "Models",
        profile_id="qwen-fast",
        plan_resolver=_plan,
        model_prepare=_model_prepare,
        aligner_prepare=_aligner_prepare,
        asr_session_factory=lambda _root, _plan: Asr(),
        aligner_session_factory=lambda _root, _plan: Aligner(),
        window_reader=reader,
        energy_reader=lambda *_args: -12.0,
    )
    assert reads == 2

    second_reports: list[dict] = []
    before = reads

    def forbidden(*_args, **_kwargs):
        raise AssertionError("checkpoint reuse must not load Qwen model or aligner")

    second = transcribe_craig_package_qwen_strict(
        package,
        root,
        tmp_path / "Models",
        profile_id="qwen-fast",
        plan_resolver=_plan,
        model_prepare=forbidden,
        aligner_prepare=forbidden,
        asr_session_factory=forbidden,
        aligner_session_factory=forbidden,
        window_reader=reader,
        energy_reader=lambda *_args: -12.0,
        report=second_reports.append,
    )

    assert reads - before == 1
    assert second.as_dict()["tracks"] == first.as_dict()["tracks"]
    assert any(item.get("code") == "ASR_CHECKPOINT_REUSED" for item in second_reports)
    assert {
        "type": "progress",
        "completed": 1,
        "total": 1,
        "unit": "tracks",
        "stage": "source_validation",
    } in second_reports
    stages = [item.get("stage") for item in second_reports if item.get("type") == "stage"]
    assert "model_prepare" not in stages
    assert "model_load" not in stages
    assert "alignment" not in stages
    assert "energy_analysis" in stages

    monkeypatch.setenv("TDA_ASR_RUNTIME_VERSION", "1.0.7")
    before_upgrade = reads
    upgraded = transcribe_craig_package_qwen_strict(
        package,
        root,
        tmp_path / "Models",
        profile_id="qwen-fast",
        plan_resolver=_plan,
        model_prepare=_model_prepare,
        aligner_prepare=_aligner_prepare,
        asr_session_factory=lambda _root, _plan: Asr(),
        aligner_session_factory=lambda _root, _plan: Aligner(),
        window_reader=reader,
        energy_reader=lambda *_args: -12.0,
    )

    assert reads - before_upgrade == 2
    assert upgraded.as_dict()["tracks"] == first.as_dict()["tracks"]
