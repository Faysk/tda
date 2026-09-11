from __future__ import annotations

from pathlib import Path

from tda_companion.asr_models import get_profile
from tda_companion.asr_qwen import (
    AudioWindow,
    QwenRuntimeError,
    transcribe_craig_package_qwen,
)
from tda_companion.craig import CraigPackage, CraigTrack
from tda_companion.qwen_acceptance import QwenPlan


def _package(tmp_path: Path, *, two_tracks: bool = True) -> tuple[CraigPackage, Path]:
    package_root = tmp_path / "Data" / "staging" / "qwen-fixture"
    tracks_root = package_root / "tracks"
    tracks_root.mkdir(parents=True)
    values: list[CraigTrack] = []
    for number, speaker in ((1, "Alice"), (2, "Bob"))[: 2 if two_tracks else 1]:
        target = tracks_root / f"{number}-{speaker}.flac"
        target.write_bytes(f"audio-{number}".encode())
        values.append(
            CraigTrack(
                number=number,
                speaker=speaker,
                filename=target.name,
                path=f"tracks/{target.name}",
                size_bytes=target.stat().st_size,
                sha256=(str(number) * 64)[:64],
                identity=None,
            )
        )
    return (
        CraigPackage(
            schema_version="tda_craig_package_v1",
            source_zip="fixture.zip",
            source_sha256="a" * 64,
            recording_id="qwen-fixture",
            guild="Guild",
            channel="mesa",
            requester="Alice",
            start_time=None,
            tracks=tuple(values),
            info_present=True,
            raw_dat_present=False,
        ),
        package_root,
    )


def _plan(_profile_id: str) -> QwenPlan:
    return QwenPlan(
        profile_id="qwen-fast",
        device="cuda",
        dtype="bfloat16",
        compute_capability="8.9",
    )


def _window_reader(path: Path):
    marker = 1 if path.name.startswith("1-") else 2
    yield AudioWindow(index=1, start=0.0, end=2.0, audio=f"track-{marker}")


def _model_prepare(_models_root: Path, profile):
    assert profile == get_profile("qwen-fast")
    return Path("qwen-model")


def _aligner_prepare(_models_root: Path):
    return Path("qwen-aligner")


def test_qwen_craig_runs_asr_then_releases_it_before_aligner_and_deduplicates(tmp_path: Path):
    package, package_root = _package(tmp_path)
    lifecycle: list[str] = []

    class Asr:
        def transcribe(self, audio, *, prompt: str):
            lifecycle.append(f"asr:{audio}")
            assert "Yuhara" in prompt
            return "Abram a porta agora", "Portuguese"

        def close(self):
            lifecycle.append("asr:closed")

    class Aligner:
        def align(self, audio, text: str, language: str):
            assert lifecycle[-1] == "asr:closed" or "align:" in lifecycle[-1]
            lifecycle.append(f"align:{audio}")
            assert text == "Abram a porta agora"
            assert language == "Portuguese"
            return [
                {"text": "Abram", "start_time": 0.10, "end_time": 0.40},
                {"text": "a", "start_time": 0.41, "end_time": 0.50},
                {"text": "porta", "start_time": 0.51, "end_time": 0.80},
                {"text": "agora", "start_time": 0.81, "end_time": 1.10},
            ]

        def close(self):
            lifecycle.append("align:closed")

    reports: list[dict] = []
    document = transcribe_craig_package_qwen(
        package,
        package_root,
        tmp_path / "Models",
        profile_id="qwen-fast",
        glossary="Yuhara",
        context="mesa principal",
        report=reports.append,
        plan_resolver=_plan,
        model_prepare=_model_prepare,
        aligner_prepare=_aligner_prepare,
        asr_session_factory=lambda _root, _plan_value: Asr(),
        aligner_session_factory=lambda _root, _plan_value: Aligner(),
        window_reader=_window_reader,
        energy_reader=lambda window, _start, _end: -10.0 if window.audio == "track-1" else -22.0,
    )

    value = document.as_dict()
    assert lifecycle == [
        "asr:track-1",
        "asr:track-2",
        "asr:closed",
        "align:track-1",
        "align:track-2",
        "align:closed",
    ]
    assert value["engine"]["engine"] == "qwen3"
    assert value["engine"]["profile"] == "qwen-fast"
    assert value["engine"]["alignment"] == "Qwen/Qwen3-ForcedAligner-0.6B-hf"
    assert len(value["tracks"]) == 2
    assert len(value["tracks"][0]["segments"]) == 1
    assert len(value["tracks"][1]["segments"]) == 1
    assert value["stats"]["segment_count"] == 2
    assert value["stats"]["deduplicated_segment_count"] == 1
    assert value["stats"]["turn_count"] == 1
    assert value["turns"][0]["speaker"] == "Alice"
    assert value["turns"][0]["segments"][0]["track_number"] == 1
    stages = [item.get("stage") for item in reports if item.get("type") == "stage"]
    assert stages == [
        "model_prepare",
        "transcription",
        "alignment",
        "cross_track_dedup",
        "merge_timeline",
        "turn_building",
        "result_prepare",
    ]


def test_qwen_alignment_failure_keeps_transcript_with_explicit_fallback(tmp_path: Path):
    package, package_root = _package(tmp_path, two_tracks=False)

    class Asr:
        def transcribe(self, _audio, *, prompt: str):
            return "Texto continua vivo", "Portuguese"

        def close(self):
            pass

    class BrokenAligner:
        def align(self, _audio, _text: str, _language: str):
            raise QwenRuntimeError("QWEN_ALIGNMENT_FAILED")

        def close(self):
            pass

    document = transcribe_craig_package_qwen(
        package,
        package_root,
        tmp_path / "Models",
        profile_id="qwen-fast",
        plan_resolver=_plan,
        model_prepare=_model_prepare,
        aligner_prepare=_aligner_prepare,
        asr_session_factory=lambda _root, _plan_value: Asr(),
        aligner_session_factory=lambda _root, _plan_value: BrokenAligner(),
        window_reader=_window_reader,
        energy_reader=lambda _window, _start, _end: -12.0,
    )

    value = document.as_dict()
    assert value["tracks"][0]["segments"][0]["text"] == "Texto continua vivo"
    assert value["tracks"][0]["segments"][0]["start"] == 0.0
    assert value["tracks"][0]["segments"][0]["end"] == 2.0
    assert value["tracks"][0]["segments"][0]["words"] == ()
    assert "+window-fallback" in value["engine"]["alignment"]
    assert value["warnings"] == ("QWEN_ALIGNMENT_FALLBACK:track-1",)


def test_qwen_fallback_warning_survives_checkpoint_restart(tmp_path: Path):
    package, package_root = _package(tmp_path, two_tracks=False)

    class Asr:
        def transcribe(self, _audio, *, prompt: str):
            return "Fallback persistente", "Portuguese"

        def close(self):
            pass

    class BrokenAligner:
        def align(self, _audio, _text: str, _language: str):
            raise QwenRuntimeError("QWEN_ALIGNMENT_FAILED")

        def close(self):
            pass

    common = dict(
        profile_id="qwen-fast",
        plan_resolver=_plan,
        model_prepare=_model_prepare,
        aligner_prepare=_aligner_prepare,
        window_reader=_window_reader,
        energy_reader=lambda _window, _start, _end: -12.0,
    )
    first = transcribe_craig_package_qwen(
        package,
        package_root,
        tmp_path / "Models",
        asr_session_factory=lambda _root, _plan_value: Asr(),
        aligner_session_factory=lambda _root, _plan_value: BrokenAligner(),
        **common,
    )
    second = transcribe_craig_package_qwen(
        package,
        package_root,
        tmp_path / "Models",
        asr_session_factory=lambda _root, _plan_value: (_ for _ in ()).throw(AssertionError("ASR should be cached")),
        aligner_session_factory=lambda _root, _plan_value: (_ for _ in ()).throw(AssertionError("aligner should be cached")),
        **common,
    )

    assert first.as_dict()["tracks"] == second.as_dict()["tracks"]
    assert first.as_dict()["warnings"] == second.as_dict()["warnings"]
    assert first.as_dict()["engine"]["alignment"] == second.as_dict()["engine"]["alignment"]


def test_qwen_exact_checkpoint_skips_both_heavy_sessions_on_restart(tmp_path: Path):
    package, package_root = _package(tmp_path, two_tracks=False)
    created = {"asr": 0, "aligner": 0}

    class Asr:
        def transcribe(self, _audio, *, prompt: str):
            return "Checkpoint funcionando", "Portuguese"

        def close(self):
            pass

    class Aligner:
        def align(self, _audio, _text: str, _language: str):
            return [
                {"text": "Checkpoint", "start_time": 0.1, "end_time": 0.6},
                {"text": "funcionando", "start_time": 0.7, "end_time": 1.2},
            ]

        def close(self):
            pass

    def asr_factory(_root, _plan_value):
        created["asr"] += 1
        return Asr()

    def aligner_factory(_root, _plan_value):
        created["aligner"] += 1
        return Aligner()

    common = dict(
        profile_id="qwen-fast",
        glossary="Yuhara",
        context="mesa",
        plan_resolver=_plan,
        model_prepare=_model_prepare,
        aligner_prepare=_aligner_prepare,
        asr_session_factory=asr_factory,
        aligner_session_factory=aligner_factory,
        window_reader=_window_reader,
        energy_reader=lambda _window, _start, _end: -10.0,
    )
    first = transcribe_craig_package_qwen(package, package_root, tmp_path / "Models", **common)
    second_reports: list[dict] = []
    second = transcribe_craig_package_qwen(
        package,
        package_root,
        tmp_path / "Models",
        report=second_reports.append,
        **common,
    )

    assert created == {"asr": 1, "aligner": 1}
    assert second.as_dict()["tracks"] == first.as_dict()["tracks"]
    assert second.as_dict()["turns"] == first.as_dict()["turns"]
    assert any(item.get("code") == "ASR_CHECKPOINT_REUSED" for item in second_reports)


def test_qwen_rejects_track_escape_before_session_creation(tmp_path: Path):
    package, package_root = _package(tmp_path, two_tracks=False)
    source = package.tracks[0]
    escaped = CraigTrack(
        number=source.number,
        speaker=source.speaker,
        filename=source.filename,
        path="../outside.flac",
        size_bytes=source.size_bytes,
        sha256=source.sha256,
        identity=None,
    )
    invalid_package = CraigPackage(
        schema_version=package.schema_version,
        source_zip=package.source_zip,
        source_sha256=package.source_sha256,
        recording_id=package.recording_id,
        guild=package.guild,
        channel=package.channel,
        requester=package.requester,
        start_time=package.start_time,
        tracks=(escaped,),
        info_present=package.info_present,
        raw_dat_present=package.raw_dat_present,
    )

    try:
        transcribe_craig_package_qwen(
            invalid_package,
            package_root,
            tmp_path / "Models",
            profile_id="qwen-fast",
            plan_resolver=_plan,
            model_prepare=_model_prepare,
            aligner_prepare=_aligner_prepare,
            asr_session_factory=lambda _root, _plan_value: (_ for _ in ()).throw(AssertionError()),
            aligner_session_factory=lambda _root, _plan_value: (_ for _ in ()).throw(AssertionError()),
            window_reader=_window_reader,
        )
    except QwenRuntimeError as exc:
        assert exc.code == "CRAIG_TRACK_PATH_INVALID"
    else:
        raise AssertionError("unsafe Craig track path was accepted")
