from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from .flac_metadata import flac_duration_seconds

TRACK_NAME = re.compile(r"^(?P<track>[1-9][0-9]*)-(?P<speaker>.+)\.flac$", re.IGNORECASE)
MAX_ENTRIES = 256
MAX_INFO_BYTES = 1024 * 1024
MAX_RAW_HEADER_BYTES = 256 * 1024
MAX_NOTE_TEXT = 4096
MAX_TRACK_BYTES = 16 * 1024**3
MAX_TOTAL_BYTES = 64 * 1024**3
MAX_COMPRESSION_RATIO = 150.0
COPY_CHUNK = 1024 * 1024


class CraigPackageError(ValueError):
    pass


@dataclass(frozen=True)
class CraigIdentity:
    username: str
    discriminator: str | None
    discord_id: str | None
    global_name: str | None = None
    bot: bool | None = None
    unknown: bool | None = None


@dataclass(frozen=True)
class CraigNote:
    offset_seconds: float
    text: str


@dataclass(frozen=True)
class CraigTrack:
    number: int
    speaker: str
    filename: str
    path: str
    size_bytes: int
    sha256: str
    identity: CraigIdentity | None
    staged_mtime_ns: int | None = None
    timeline_offset_seconds: float = 0.0
    duration_seconds: float | None = None


@dataclass(frozen=True)
class CraigPackage:
    schema_version: str
    source_zip: str
    source_sha256: str
    recording_id: str | None
    guild: str | None
    channel: str | None
    requester: str | None
    start_time: str | None
    tracks: tuple[CraigTrack, ...]
    info_present: bool
    raw_dat_present: bool
    guild_id: str | None = None
    channel_id: str | None = None
    requester_id: str | None = None
    notes: tuple[CraigNote, ...] = ()
    metadata_consistency: str = "unavailable"
    raw_metadata_state: str = "missing"
    metadata_sources: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def physical_track_filename(number: int) -> str:
    if not isinstance(number, int) or isinstance(number, bool) or number < 1:
        raise CraigPackageError("CRAIG_TRACK_NUMBER_INVALID")
    return f"track-{number:06d}.flac"


def _member_name(info: zipfile.ZipInfo) -> str:
    # ZIP paths are POSIX regardless of host platform.
    value = info.filename.replace("\\", "/")
    path = PurePosixPath(value)
    if not value or value.startswith("/") or path.is_absolute():
        raise CraigPackageError("CRAIG_ARCHIVE_ABSOLUTE_PATH")
    if any(part in ("", ".", "..") for part in path.parts):
        raise CraigPackageError("CRAIG_ARCHIVE_UNSAFE_PATH")
    if len(path.parts) != 1:
        raise CraigPackageError("CRAIG_ARCHIVE_NESTED_PATH")
    return path.name


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return bool(mode and stat.S_ISLNK(mode))


def _ratio(info: zipfile.ZipInfo) -> float:
    if info.file_size <= 0:
        return 1.0
    return info.file_size / max(info.compress_size, 1)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(COPY_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_member(archive: zipfile.ZipFile, info: zipfile.ZipInfo, target: Path) -> str:
    digest = hashlib.sha256()
    temporary = target.with_suffix(target.suffix + ".partial")
    written = 0
    with archive.open(info, "r") as source, temporary.open("wb") as destination:
        while True:
            chunk = source.read(COPY_CHUNK)
            if not chunk:
                break
            written += len(chunk)
            if written > info.file_size:
                raise CraigPackageError("CRAIG_ARCHIVE_SIZE_MISMATCH")
            digest.update(chunk)
            destination.write(chunk)
        destination.flush()
        os.fsync(destination.fileno())
    if written != info.file_size:
        temporary.unlink(missing_ok=True)
        raise CraigPackageError("CRAIG_ARCHIVE_SIZE_MISMATCH")
    os.replace(temporary, target)
    return digest.hexdigest()


_LABEL_ID = re.compile(r"^(?P<label>.+?)\s+\((?P<id>[0-9]{1,32})\)$")
_INFO_IDENTITY = re.compile(
    r"^(?P<name>.+?)(?:#(?P<disc>[^\s()]+))?\s+\((?P<id>[0-9]{1,32})\)$"
)
_NOTE_LINE = re.compile(
    r"^(?P<hours>[0-9]+):(?P<minutes>[0-5][0-9]):(?P<seconds>[0-5][0-9]):\s*(?P<text>.+)$"
)


def _label_and_id(value: str) -> tuple[str, str | None]:
    match = _LABEL_ID.fullmatch(value.strip())
    if match is None:
        return value.strip(), None
    return match.group("label").strip(), match.group("id")


def parse_info_text(text: str) -> dict[str, object]:
    """Parse Craig's public info.txt format without depending on Discord APIs."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    value: dict[str, object] = {"tracks": [], "notes": []}
    if lines and lines[0].startswith("Recording "):
        value["recording_id"] = lines[0][len("Recording ") :].strip() or None

    labels = {
        "Guild:": ("guild", "guild_id"),
        "Channel:": ("channel", "channel_id"),
        "Requester:": ("requester", "requester_id"),
        "Start time:": ("start_time", None),
    }
    in_tracks = False
    in_notes = False
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped == "Tracks:":
            in_tracks = True
            in_notes = False
            continue
        if stripped == "Notes:":
            in_tracks = False
            in_notes = True
            continue

        matched_label = False
        for prefix, (key, id_key) in labels.items():
            if stripped.startswith(prefix):
                raw_value = stripped[len(prefix) :].strip()
                if key == "start_time":
                    value[key] = raw_value or None
                else:
                    label, identifier = _label_and_id(raw_value)
                    value[key] = label or None
                    if id_key is not None:
                        value[id_key] = identifier
                matched_label = True
                in_tracks = False
                in_notes = False
                break
        if matched_label:
            continue

        if in_tracks:
            identity = _INFO_IDENTITY.fullmatch(stripped)
            if identity:
                tracks = value["tracks"]
                assert isinstance(tracks, list)
                tracks.append(
                    {
                        "track": len(tracks) + 1,
                        "username": identity.group("name").strip(),
                        "discriminator": identity.group("disc"),
                        "discord_id": identity.group("id"),
                    }
                )
            continue

        if in_notes:
            note = _NOTE_LINE.fullmatch(stripped)
            if note is None:
                continue
            note_text = note.group("text").strip()
            if not note_text or len(note_text) > MAX_NOTE_TEXT:
                continue
            offset = (
                int(note.group("hours")) * 3600
                + int(note.group("minutes")) * 60
                + int(note.group("seconds"))
            )
            notes = value["notes"]
            assert isinstance(notes, list)
            notes.append({"offset_seconds": float(offset), "text": note_text})
    return value


def _optional_raw_text(value: Any, maximum: int) -> str | None:
    if not isinstance(value, str):
        return None
    result = value.strip()
    if not result or len(result) > maximum:
        return None
    return result


def _raw_extra_id(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    return _optional_raw_text(value.get("id"), 64)


def _raw_extra_name(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    return _optional_raw_text(value.get("name"), 512)


def _parse_raw_metadata(value: Any) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    tracks_raw = value.get("tracks")
    tracks: dict[int, dict[str, object]] = {}
    if isinstance(tracks_raw, dict):
        for key, raw_track in tracks_raw.items():
            if not isinstance(raw_track, dict):
                continue
            try:
                number = int(key)
            except (TypeError, ValueError):
                continue
            if number < 1 or number > MAX_ENTRIES:
                continue
            username = _optional_raw_text(raw_track.get("username"), 160)
            discord_id = _optional_raw_text(raw_track.get("id"), 64)
            if username is None and discord_id is None:
                continue
            tracks[number] = {
                "track": number,
                "username": username,
                "discriminator": _optional_raw_text(raw_track.get("discriminator"), 32),
                "discord_id": discord_id,
                "global_name": _optional_raw_text(raw_track.get("globalName"), 160),
                "bot": raw_track.get("bot") if isinstance(raw_track.get("bot"), bool) else None,
                "unknown": raw_track.get("unknown") if isinstance(raw_track.get("unknown"), bool) else None,
            }

    guild_extra = value.get("guildExtra")
    channel_extra = value.get("channelExtra")
    requester_extra = value.get("requesterExtra")
    requester = _optional_raw_text(value.get("requester"), 512)
    if isinstance(requester_extra, dict):
        requester = _optional_raw_text(requester_extra.get("username"), 160) or requester

    return {
        "recording_id": _optional_raw_text(value.get("id"), 256),
        "guild": _raw_extra_name(guild_extra) or _optional_raw_text(value.get("guild"), 512),
        "guild_id": _raw_extra_id(guild_extra),
        "channel": _raw_extra_name(channel_extra) or _optional_raw_text(value.get("channel"), 512),
        "channel_id": _raw_extra_id(channel_extra),
        "requester": requester,
        "requester_id": _optional_raw_text(value.get("requesterId"), 64),
        "start_time": _optional_raw_text(value.get("startTime"), 128),
        "tracks": tracks,
    }


def _read_raw_metadata(
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo | None,
) -> tuple[dict[str, object] | None, str]:
    if member is None:
        return None, "missing"
    try:
        with archive.open(member, "r") as source:
            line = source.readline(MAX_RAW_HEADER_BYTES + 1)
    except (OSError, RuntimeError, zipfile.BadZipFile):
        return None, "invalid"
    if len(line) > MAX_RAW_HEADER_BYTES:
        return None, "oversized"
    if not line.endswith(b"\n"):
        return None, "invalid"
    try:
        decoded = line[:-1].decode("utf-8")
        raw = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "invalid"
    parsed = _parse_raw_metadata(raw)
    return (parsed, "parsed") if parsed is not None else (None, "invalid")


def _track_rows(value: dict[str, object] | None) -> dict[int, dict[str, object]]:
    if value is None:
        return {}
    rows = value.get("tracks")
    if isinstance(rows, dict):
        return {
            number: row
            for number, row in rows.items()
            if isinstance(number, int) and isinstance(row, dict)
        }
    if not isinstance(rows, list):
        return {}
    result: dict[int, dict[str, object]] = {}
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        number = row.get("track")
        if isinstance(number, bool) or not isinstance(number, int):
            number = index
        if number > 0:
            result[number] = row
    return result


def _metadata_consistency(
    info_value: dict[str, object],
    raw_value: dict[str, object] | None,
) -> str:
    if raw_value is None:
        return (
            "partial"
            if any(info_value.get(key) is not None for key in ("recording_id", "start_time"))
            else "unavailable"
        )

    compared = 0
    for key in ("recording_id", "start_time", "guild_id", "channel_id", "requester_id"):
        left, right = info_value.get(key), raw_value.get(key)
        if left is None or right is None:
            continue
        compared += 1
        if left != right:
            return "conflicting"

    info_tracks = _track_rows(info_value)
    raw_tracks = _track_rows(raw_value)
    for number in sorted(set(info_tracks) & set(raw_tracks)):
        left = info_tracks[number].get("discord_id")
        right = raw_tracks[number].get("discord_id")
        if left is None or right is None:
            continue
        compared += 1
        if left != right:
            return "conflicting"

    if compared > 0:
        return "consistent"
    return "partial"


def _merged_strong_text(
    info_value: dict[str, object],
    raw_value: dict[str, object] | None,
    key: str,
    *,
    maximum: int,
) -> str | None:
    left = _optional_raw_text(info_value.get(key), maximum)
    right = _optional_raw_text(raw_value.get(key), maximum) if raw_value is not None else None
    if left is not None and right is not None and left != right:
        return None
    return left or right


def _identity_for_track(
    number: int,
    info_value: dict[str, object],
    raw_value: dict[str, object] | None,
) -> CraigIdentity | None:
    info = _track_rows(info_value).get(number)
    raw = _track_rows(raw_value).get(number)
    if info is None and raw is None:
        return None

    username = None
    for row in (raw, info):
        if row is not None:
            username = _optional_raw_text(row.get("username"), 160)
            if username is not None:
                break
    if username is None:
        username = f"Track {number}"

    info_id = _optional_raw_text(info.get("discord_id"), 64) if info is not None else None
    raw_id = _optional_raw_text(raw.get("discord_id"), 64) if raw is not None else None
    discord_id = None if info_id and raw_id and info_id != raw_id else (raw_id or info_id)

    return CraigIdentity(
        username=username,
        discriminator=(
            _optional_raw_text(raw.get("discriminator"), 32)
            if raw is not None
            else None
        )
        or (
            _optional_raw_text(info.get("discriminator"), 32)
            if info is not None
            else None
        ),
        discord_id=discord_id,
        global_name=(
            _optional_raw_text(raw.get("global_name"), 160)
            if raw is not None
            else None
        ),
        bot=raw.get("bot") if raw is not None and isinstance(raw.get("bot"), bool) else None,
        unknown=(
            raw.get("unknown")
            if raw is not None and isinstance(raw.get("unknown"), bool)
            else None
        ),
    )


def _safe_start_time(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if len(text) > 128:
        return None
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    return text


def inspect_craig_zip(source_zip: Path) -> tuple[list[tuple[zipfile.ZipInfo, int, str]], zipfile.ZipInfo | None, bool]:
    source_zip = source_zip.resolve()
    if not source_zip.is_file():
        raise CraigPackageError("CRAIG_ARCHIVE_NOT_FOUND")
    try:
        archive = zipfile.ZipFile(source_zip, "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise CraigPackageError("CRAIG_ARCHIVE_INVALID") from exc

    with archive:
        infos = [item for item in archive.infolist() if not item.is_dir()]
        if not infos or len(infos) > MAX_ENTRIES:
            raise CraigPackageError("CRAIG_ARCHIVE_ENTRY_LIMIT")
        total = 0
        tracks: list[tuple[zipfile.ZipInfo, int, str]] = []
        seen_numbers: set[int] = set()
        info_member: zipfile.ZipInfo | None = None
        raw_present = False
        names: set[str] = set()
        for item in infos:
            name = _member_name(item)
            folded = name.casefold()
            if folded in names:
                raise CraigPackageError("CRAIG_ARCHIVE_DUPLICATE_NAME")
            names.add(folded)
            if _is_symlink(item):
                raise CraigPackageError("CRAIG_ARCHIVE_SYMLINK")
            if item.file_size < 0 or item.compress_size < 0:
                raise CraigPackageError("CRAIG_ARCHIVE_INVALID_SIZE")
            total += item.file_size
            if total > MAX_TOTAL_BYTES:
                raise CraigPackageError("CRAIG_ARCHIVE_TOTAL_SIZE_LIMIT")
            if _ratio(item) > MAX_COMPRESSION_RATIO:
                raise CraigPackageError("CRAIG_ARCHIVE_COMPRESSION_RATIO")

            match = TRACK_NAME.fullmatch(name)
            if match:
                if item.file_size <= 0 or item.file_size > MAX_TRACK_BYTES:
                    raise CraigPackageError("CRAIG_TRACK_SIZE_LIMIT")
                number = int(match.group("track"))
                if number in seen_numbers:
                    raise CraigPackageError("CRAIG_TRACK_NUMBER_DUPLICATE")
                seen_numbers.add(number)
                speaker = match.group("speaker").strip()
                if not speaker or len(speaker) > 160:
                    raise CraigPackageError("CRAIG_TRACK_SPEAKER_INVALID")
                tracks.append((item, number, speaker))
            elif folded == "info.txt":
                if item.file_size > MAX_INFO_BYTES:
                    raise CraigPackageError("CRAIG_INFO_SIZE_LIMIT")
                info_member = item
            elif folded == "raw.dat":
                raw_present = True
            else:
                raise CraigPackageError("CRAIG_ARCHIVE_UNEXPECTED_FILE")

        if not tracks:
            raise CraigPackageError("CRAIG_ARCHIVE_NO_TRACKS")
        tracks.sort(key=lambda value: value[1])
        return tracks, info_member, raw_present


def ingest_craig_zip(
    source_zip: Path,
    destination: Path,
    *,
    source_sha256: str | None = None,
    source_name: str | None = None,
) -> CraigPackage:
    """Safely materialize only FLAC tracks and bounded metadata from a Craig ZIP.

    Callers that already hashed an immutable local snapshot while streaming it may
    pass that digest to avoid re-reading the full archive before extraction.
    """
    source_zip = source_zip.resolve()
    destination = destination.resolve()
    tracks, info_member, raw_present = inspect_craig_zip(source_zip)
    if source_sha256 is None:
        source_sha = _sha256_file(source_zip)
    else:
        source_sha = source_sha256.strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", source_sha):
            raise CraigPackageError("CRAIG_SOURCE_HASH_INVALID")
    logical_source_name = source_name or source_zip.name
    if (
        not logical_source_name
        or len(logical_source_name) > 512
        or Path(logical_source_name).name != logical_source_name
        or "/" in logical_source_name
        or "\\" in logical_source_name
    ):
        raise CraigPackageError("CRAIG_SOURCE_NAME_INVALID")
    staging = destination.parent / f".{destination.name}-{uuid4().hex}.partial"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=False)

    try:
        info_value: dict[str, object] = {"tracks": [], "notes": []}
        info_present = info_member is not None
        raw_value: dict[str, object] | None = None
        raw_metadata_state = "missing"
        with zipfile.ZipFile(source_zip, "r") as archive:
            raw_member = next(
                (
                    item
                    for item in archive.infolist()
                    if not item.is_dir() and _member_name(item).casefold() == "raw.dat"
                ),
                None,
            )
            raw_value, raw_metadata_state = _read_raw_metadata(archive, raw_member)

            if info_member is not None:
                raw_info = archive.read(info_member)
                if len(raw_info) > MAX_INFO_BYTES:
                    raise CraigPackageError("CRAIG_INFO_SIZE_LIMIT")
                try:
                    info_text = raw_info.decode("utf-8-sig")
                except UnicodeDecodeError as exc:
                    raise CraigPackageError("CRAIG_INFO_ENCODING") from exc
                info_value = parse_info_text(info_text)
                (staging / "info.txt").write_text(info_text, encoding="utf-8", newline="\n")

            output_tracks: list[CraigTrack] = []
            tracks_root = staging / "tracks"
            tracks_root.mkdir()
            for member, number, speaker in tracks:
                source_filename = _member_name(member)
                physical_filename = physical_track_filename(number)
                target = tracks_root / physical_filename
                digest = _copy_member(archive, member, target)
                output_tracks.append(
                    CraigTrack(
                        number=number,
                        speaker=speaker,
                        filename=source_filename,
                        path=f"tracks/{physical_filename}",
                        size_bytes=member.file_size,
                        sha256=digest,
                        identity=_identity_for_track(number, info_value, raw_value),
                        staged_mtime_ns=target.stat().st_mtime_ns,
                        duration_seconds=flac_duration_seconds(target),
                    )
                )

        metadata_consistency = _metadata_consistency(info_value, raw_value)
        notes_value = info_value.get("notes")
        notes = (
            tuple(
                CraigNote(
                    offset_seconds=float(row["offset_seconds"]),
                    text=str(row["text"]),
                )
                for row in notes_value
                if isinstance(row, dict)
                and isinstance(row.get("offset_seconds"), (int, float))
                and not isinstance(row.get("offset_seconds"), bool)
                and isinstance(row.get("text"), str)
            )
            if isinstance(notes_value, list)
            else ()
        )

        package = CraigPackage(
            schema_version="tda_craig_package_v1",
            source_zip=logical_source_name,
            source_sha256=source_sha,
            recording_id=_merged_strong_text(
                info_value, raw_value, "recording_id", maximum=256
            ),
            guild=(
                _optional_raw_text(info_value.get("guild"), 512)
                or (
                    _optional_raw_text(raw_value.get("guild"), 512)
                    if raw_value is not None
                    else None
                )
            ),
            channel=(
                _optional_raw_text(info_value.get("channel"), 512)
                or (
                    _optional_raw_text(raw_value.get("channel"), 512)
                    if raw_value is not None
                    else None
                )
            ),
            requester=(
                _optional_raw_text(info_value.get("requester"), 512)
                or (
                    _optional_raw_text(raw_value.get("requester"), 512)
                    if raw_value is not None
                    else None
                )
            ),
            start_time=_safe_start_time(
                _merged_strong_text(info_value, raw_value, "start_time", maximum=128)
            ),
            tracks=tuple(output_tracks),
            info_present=info_present,
            raw_dat_present=raw_present,
            guild_id=_merged_strong_text(
                info_value, raw_value, "guild_id", maximum=64
            ),
            channel_id=_merged_strong_text(
                info_value, raw_value, "channel_id", maximum=64
            ),
            requester_id=_merged_strong_text(
                info_value, raw_value, "requester_id", maximum=64
            ),
            notes=notes,
            metadata_consistency=metadata_consistency,
            raw_metadata_state=raw_metadata_state,
            metadata_sources=tuple(
                source
                for source, present in (
                    ("info_txt", info_present),
                    ("raw_dat_header", raw_value is not None),
                )
                if present
            ),
        )
        manifest = staging / "manifest.json"
        manifest.write_text(
            json.dumps(package.as_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )
        if destination.exists():
            raise CraigPackageError("CRAIG_DESTINATION_EXISTS")
        try:
            os.replace(staging, destination)
        except OSError as exc:
            # Another ingest of the same content may win after the exists()
            # check but before the atomic promotion. Surface that as the normal
            # content-addressed reuse race instead of a generic storage failure.
            if destination.is_dir():
                raise CraigPackageError("CRAIG_DESTINATION_EXISTS") from exc
            raise
        return package
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
