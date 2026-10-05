from __future__ import annotations

import json
import zipfile
from pathlib import Path

from tda_companion.craig import (
    MAX_RAW_HEADER_BYTES,
    ingest_craig_zip,
    parse_info_text,
)
from tda_companion.craig_runtime import load_craig_package


def _flac_bytes(duration_seconds: int = 1, sample_rate: int = 48_000) -> bytes:
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


def _raw_metadata(
    *,
    recording_id: str = "12345",
    start_time: str = "2026-09-19T17:20:40.056Z",
    first_id: str = "111",
) -> dict[str, object]:
    return {
        "format": 1,
        "id": recording_id,
        "guild": "legacy-guild",
        "guildExtra": {"id": "10", "name": "Test Guild"},
        "channel": "legacy-channel",
        "channelExtra": {"id": "20", "name": "table"},
        "requester": "legacy-requester",
        "requesterExtra": {
            "id": "30",
            "username": "gm",
            "discriminator": "0",
        },
        "requesterId": "30",
        "startTime": start_time,
        "tracks": {
            "1": {
                "id": first_id,
                "username": "alice",
                "discriminator": "0",
                "globalName": "Alice",
                "bot": False,
                "unknown": False,
            },
            "2": {
                "id": "222",
                "username": "musicbot",
                "discriminator": "0",
                "globalName": "Music Bot",
                "bot": True,
                "unknown": False,
            },
        },
    }


def _info_text(
    *,
    start_time: str = "2026-09-19T17:20:40.056Z",
    first_id: str | None = "111",
) -> str:
    first = "alice#0" + (f" ({first_id})" if first_id else "")
    return (
        "Recording 12345\r\n"
        "\r\n"
        "Guild:\t\tTest Guild (10)\r\n"
        "Channel:\ttable (20)\r\n"
        "Requester:\tgm#0 (30)\r\n"
        f"Start time:\t{start_time}\r\n"
        "\r\n"
        "Tracks:\r\n"
        f"\t{first}\r\n"
        "\tmusicbot#0 (222)\r\n"
        "Notes:\r\n"
        "\t0:00:05: Initiative\r\n"
        "\t1:02:03: Break\r\n"
    )


def _write_zip(
    path: Path,
    *,
    info: str | None,
    raw_header: dict[str, object] | bytes | None,
    raw_tail: bytes = b"OggS-synthetic-payload",
) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-alice.flac", _flac_bytes())
        archive.writestr("2-musicbot.flac", _flac_bytes())
        if info is not None:
            archive.writestr("info.txt", info)
        if raw_header is not None:
            if isinstance(raw_header, dict):
                prefix = json.dumps(
                    raw_header,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8") + b"\n"
            else:
                prefix = raw_header
            archive.writestr("raw.dat", prefix + raw_tail)


def _ingest(tmp_path: Path, **kwargs):
    source = tmp_path / "session.zip"
    destination = tmp_path / "staged"
    _write_zip(source, **kwargs)
    package = ingest_craig_zip(source, destination)
    loaded = load_craig_package(destination, verify_tracks=True)
    return package, loaded, destination


def test_parse_info_preserves_timestamped_notes_and_trailing_ids():
    parsed = parse_info_text(_info_text())

    assert parsed["guild_id"] == "10"
    assert parsed["channel_id"] == "20"
    assert parsed["requester_id"] == "30"
    assert parsed["tracks"] == [
        {
            "number": 1,
            "username": "alice",
            "discriminator": "0",
            "discord_id": "111",
        },
        {
            "number": 2,
            "username": "musicbot",
            "discriminator": "0",
            "discord_id": "222",
        },
    ]
    assert parsed["notes"] == [
        {"offset_seconds": 5.0, "text": "Initiative"},
        {"offset_seconds": 3723.0, "text": "Break"},
    ]


def test_ingest_cross_checks_info_and_raw_and_preserves_structured_identity(tmp_path: Path):
    package, loaded, destination = _ingest(
        tmp_path,
        info=_info_text(),
        raw_header=_raw_metadata(),
    )

    for value in (package, loaded):
        assert value.recording_id == "12345"
        assert value.start_time == "2026-09-19T17:20:40.056Z"
        assert value.guild_id == "10"
        assert value.channel_id == "20"
        assert value.requester_id == "30"
        assert value.raw_dat_present is True
        assert value.raw_metadata_parsed is True
        assert value.metadata_consistency == "consistent"
        assert value.metadata_warnings == ()
        assert [(note.offset_seconds, note.text) for note in value.notes] == [
            (5.0, "Initiative"),
            (3723.0, "Break"),
        ]
        assert value.tracks[0].identity is not None
        assert value.tracks[0].identity.discord_id == "111"
        assert value.tracks[0].identity.global_name == "Alice"
        assert value.tracks[0].identity.bot is False
        assert value.tracks[0].identity.unknown is False
        assert value.tracks[1].identity is not None
        assert value.tracks[1].identity.bot is True

    assert not (destination / "raw.dat").exists()


def test_raw_metadata_fills_identity_when_info_has_no_discord_ids(tmp_path: Path):
    package, loaded, _ = _ingest(
        tmp_path,
        info=_info_text(first_id=None).replace("musicbot#0 (222)", "musicbot#0"),
        raw_header=_raw_metadata(),
    )

    assert package.metadata_consistency == "consistent"
    assert loaded.tracks[0].identity is not None
    assert loaded.tracks[0].identity.discord_id == "111"
    assert loaded.tracks[1].identity is not None
    assert loaded.tracks[1].identity.discord_id == "222"


def test_raw_only_metadata_is_optional_enrichment_not_an_ingest_gate(tmp_path: Path):
    package, loaded, _ = _ingest(
        tmp_path,
        info=None,
        raw_header=_raw_metadata(),
    )

    assert package.info_present is False
    assert package.raw_dat_present is True
    assert package.raw_metadata_parsed is True
    assert package.metadata_consistency == "partial"
    assert loaded.start_time == "2026-09-19T17:20:40.056Z"
    assert loaded.tracks[0].identity is not None
    assert loaded.tracks[0].identity.discord_id == "111"
    assert loaded.notes == ()


def test_info_only_metadata_remains_backward_compatible(tmp_path: Path):
    package, loaded, _ = _ingest(
        tmp_path,
        info=_info_text(),
        raw_header=None,
    )

    assert package.info_present is True
    assert package.raw_dat_present is False
    assert package.raw_metadata_parsed is False
    assert package.metadata_consistency == "partial"
    assert loaded.tracks[0].identity is not None
    assert loaded.tracks[0].identity.discord_id == "111"
    assert loaded.notes[0].text == "Initiative"


def test_conflicting_strong_metadata_fails_closed_without_dropping_tracks(tmp_path: Path):
    package, loaded, _ = _ingest(
        tmp_path,
        info=_info_text(),
        raw_header=_raw_metadata(
            start_time="2026-09-19T18:20:40.056Z",
            first_id="999",
        ),
    )

    for value in (package, loaded):
        assert value.metadata_consistency == "conflicting"
        assert value.start_time is None
        assert "CRAIG_START_TIME_CONFLICT" in value.metadata_warnings
        assert "CRAIG_TRACK_IDENTITY_CONFLICT:1" in value.metadata_warnings
        assert len(value.tracks) == 2
        assert value.tracks[0].identity is not None
        assert value.tracks[0].identity.discord_id is None


def test_equivalent_absolute_instants_do_not_create_false_conflict(tmp_path: Path):
    package, _, _ = _ingest(
        tmp_path,
        info=_info_text(start_time="2026-09-19T17:20:40.056Z"),
        raw_header=_raw_metadata(start_time="2026-09-19T18:20:40.056+01:00"),
    )

    assert package.metadata_consistency == "consistent"
    assert package.start_time == "2026-09-19T17:20:40.056Z"
    assert "CRAIG_START_TIME_CONFLICT" not in package.metadata_warnings


def test_malformed_raw_header_is_warning_and_valid_info_still_ingests(tmp_path: Path):
    package, loaded, _ = _ingest(
        tmp_path,
        info=_info_text(),
        raw_header=b"not-json\n",
    )

    assert package.raw_dat_present is True
    assert package.raw_metadata_parsed is False
    assert package.metadata_consistency == "partial"
    assert package.start_time == "2026-09-19T17:20:40.056Z"
    assert package.metadata_warnings == ("CRAIG_RAW_METADATA_INVALID",)
    assert loaded.tracks[0].identity is not None
    assert loaded.tracks[0].identity.discord_id == "111"


def test_raw_header_read_is_bounded_and_does_not_block_valid_tracks(tmp_path: Path):
    package, loaded, destination = _ingest(
        tmp_path,
        info=_info_text(),
        raw_header=b"{" + (b"x" * (MAX_RAW_HEADER_BYTES + 32)),
        raw_tail=b"",
    )

    assert package.raw_dat_present is True
    assert package.raw_metadata_parsed is False
    assert package.metadata_consistency == "partial"
    assert package.metadata_warnings == ("CRAIG_RAW_METADATA_HEADER_LIMIT",)
    assert len(loaded.tracks) == 2
    assert not (destination / "raw.dat").exists()
