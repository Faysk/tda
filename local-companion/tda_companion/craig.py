from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from uuid import uuid4

from .flac_metadata import flac_duration_seconds

TRACK_NAME = re.compile(r"^(?P<track>[1-9][0-9]*)-(?P<speaker>.+)\.flac$", re.IGNORECASE)
MAX_ENTRIES = 256
MAX_INFO_BYTES = 1024 * 1024
MAX_RAW_HEADER_BYTES = 256 * 1024
MAX_NOTE_COUNT = 4096
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
    raw_metadata_parsed: bool = False
    metadata_consistency: str = "unavailable"
    metadata_warnings: tuple[str, ...] = ()
    export_job_id: str | None = None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def physical_track_filename(number: int) -> str:
    if not isinstance(number, int) or isinstance(number, bool) or number < 1:
        raise CraigPackageError("CRAIG_TRACK_NUMBER_INVALID")
    return f"track-{number:06d}.flac"


def plain_flac_speaker(filename: str) -> str | None:
    """Recognize a flat audio-only source name, never a physical target path."""
    if (not isinstance(filename, str) or len(filename) > 512
            or "/" in filename or "\\" in filename
            or any(ord(char) < 32 for char in filename)
            or not filename.lower().endswith(".flac")
            or TRACK_NAME.fullmatch(filename)):
        return None
    speaker = filename[:-5].strip()
    return speaker if speaker and len(speaker) <= 160 else None


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


def parse_info_text(text: str) -> dict[str, object]:
    """Parse Craig's public info.txt format without depending on Discord APIs."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    value: dict[str, object] = {"tracks": [], "notes": []}
    if lines and lines[0].startswith("Recording "):
        value["recording_id"] = lines[0][len("Recording ") :].strip() or None

    labels = {
        "Guild:": "guild",
        "Channel:": "channel",
        "Requester:": "requester",
        "Start time:": "start_time",
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
        for prefix, key in labels.items():
            if stripped.startswith(prefix):
                label_value = stripped[len(prefix) :].strip() or None
                value[key] = label_value
                if key in {"guild", "channel", "requester"} and label_value:
                    trailing_id = re.search(r"\((?P<id>[0-9]{1,32})\)\s*$", label_value)
                    if trailing_id:
                        value[f"{key}_id"] = trailing_id.group("id").strip()
                matched_label = True
                in_tracks = False
                in_notes = False
                break
        if matched_label:
            continue
        if in_tracks:
            identity = re.match(
                r"^(?P<name>.+?)(?:#(?P<disc>[^\s()]+))?(?:\s+\((?P<id>[^()]+)\))?$",
                stripped,
            )
            if identity and identity.group("name").strip():
                tracks = value["tracks"]
                assert isinstance(tracks, list)
                tracks.append(
                    {
                        "username": identity.group("name").strip(),
                        "discriminator": identity.group("disc"),
                        "discord_id": identity.group("id").strip()
                        if identity.group("id")
                        else None,
                    }
                )
            continue
        if in_notes:
            note = re.match(
                r"^(?P<hours>[0-9]+):(?P<minutes>[0-5][0-9]):(?P<seconds>[0-5][0-9](?:\.[0-9]+)?):\s*(?P<text>.*)$",
                stripped,
            )
            if not note:
                continue
            notes = value["notes"]
            assert isinstance(notes, list)
            if len(notes) >= MAX_NOTE_COUNT:
                continue
            note_text = note.group("text").strip()
            if not note_text:
                continue
            notes.append(
                {
                    "offset_seconds": (
                        int(note.group("hours")) * 3600
                        + int(note.group("minutes")) * 60
                        + float(note.group("seconds"))
                    ),
                    "text": note_text[:MAX_NOTE_TEXT],
                }
            )
    return value


def _bounded_text(value: object, *, maximum: int) -> str | None:
    if not isinstance(value, str):
        return None
    result = value.strip()
    if not result or len(result) > maximum:
        return None
    if any(ord(char) < 32 and char not in "\t" for char in result):
        return None
    return result


def _raw_extra(value: object) -> tuple[str | None, str | None]:
    if not isinstance(value, dict):
        return None, None
    return (
        _bounded_text(value.get("id"), maximum=128),
        _bounded_text(value.get("name") or value.get("username"), maximum=512),
    )


def _parse_raw_metadata_header(
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo,
) -> tuple[dict[str, object] | None, str | None]:
    """Read only Craig's bounded JSON prefix from raw.dat; never materialize its audio."""
    try:
        with archive.open(member, "r") as source:
            prefix = source.readline(MAX_RAW_HEADER_BYTES + 1)
    except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile):
        return None, "CRAIG_RAW_METADATA_READ_FAILED"
    newline = prefix.find(b"\n")
    if newline < 0:
        return None, (
            "CRAIG_RAW_METADATA_HEADER_LIMIT"
            if len(prefix) > MAX_RAW_HEADER_BYTES
            else "CRAIG_RAW_METADATA_HEADER_INVALID"
        )
    if newline > MAX_RAW_HEADER_BYTES:
        return None, "CRAIG_RAW_METADATA_HEADER_LIMIT"
    try:
        decoded = prefix[:newline].decode("utf-8")
        raw = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "CRAIG_RAW_METADATA_INVALID"
    if not isinstance(raw, dict):
        return None, "CRAIG_RAW_METADATA_INVALID"

    normalized: dict[str, object] = {"tracks": []}
    # Craig kitchen passes Job.id to recordingWrite, not Job.recordingId.
    # This provenance must never participate in recording variant matching.
    export_job_id = _bounded_text(raw.get("id"), maximum=256)
    if export_job_id:
        normalized["export_job_id"] = export_job_id
    start_time = _bounded_text(raw.get("startTime"), maximum=128)
    if start_time:
        normalized["start_time"] = start_time

    guild_id, guild_name = _raw_extra(raw.get("guildExtra"))
    channel_id, channel_name = _raw_extra(raw.get("channelExtra"))
    requester_extra = raw.get("requesterExtra")
    requester_id = _bounded_text(raw.get("requesterId"), maximum=128)
    requester_name = None
    if isinstance(requester_extra, dict):
        requester_name = _bounded_text(
            requester_extra.get("username") or requester_extra.get("name"),
            maximum=512,
        )
        requester_id = requester_id or _bounded_text(
            requester_extra.get("id"),
            maximum=128,
        )

    if not guild_name:
        guild_name = _bounded_text(raw.get("guild"), maximum=512)
    if not channel_name:
        channel_name = _bounded_text(raw.get("channel"), maximum=512)
    if not requester_name:
        requester_name = _bounded_text(raw.get("requester"), maximum=512)

    for key, item in (
        ("guild_id", guild_id),
        ("guild", guild_name),
        ("channel_id", channel_id),
        ("channel", channel_name),
        ("requester_id", requester_id),
        ("requester", requester_name),
    ):
        if item:
            normalized[key] = item

    raw_tracks = raw.get("tracks")
    rows: list[dict[str, object]] = []
    if isinstance(raw_tracks, dict):
        for key, raw_track in raw_tracks.items():
            try:
                number = int(key)
            except (TypeError, ValueError):
                continue
            if number < 1 or not isinstance(raw_track, dict):
                continue
            username = _bounded_text(raw_track.get("username"), maximum=160)
            discord_id = _bounded_text(raw_track.get("id"), maximum=64)
            if not username and not discord_id:
                continue
            discriminator = _bounded_text(raw_track.get("discriminator"), maximum=32)
            global_name = _bounded_text(raw_track.get("globalName"), maximum=160)
            bot = raw_track.get("bot")
            unknown = raw_track.get("unknown")
            rows.append(
                {
                    "number": number,
                    "username": username,
                    "discriminator": discriminator,
                    "discord_id": discord_id,
                    "global_name": global_name,
                    "bot": bot if isinstance(bot, bool) else None,
                    "unknown": unknown if isinstance(unknown, bool) else None,
                }
            )
    rows.sort(key=lambda item: int(item["number"]))
    normalized["tracks"] = rows
    return normalized, None


def _canonical_instant(value: object) -> str | None:
    text = _bounded_text(value, maximum=128)
    if text is None:
        return None
    try:
        instant = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    if instant.tzinfo is None:
        return text
    return instant.astimezone(timezone.utc).isoformat()


def _merge_strong_value(
    info_value: object,
    raw_value: object,
    *,
    canonicalize=lambda value: value,
) -> tuple[str | None, bool]:
    info = _bounded_text(info_value, maximum=512)
    raw = _bounded_text(raw_value, maximum=512)
    if info is None:
        return raw, False
    if raw is None:
        return info, False
    if canonicalize(info) != canonicalize(raw):
        return None, True
    return info, False


def _identity_by_number(value: dict[str, object]) -> dict[int, dict[str, object]]:
    raw = value.get("tracks")
    rows = raw if isinstance(raw, list) else []
    result: dict[int, dict[str, object]] = {}
    for index, item in enumerate(rows):
        if not isinstance(item, dict):
            continue
        number = item.get("number")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1:
            number = index + 1
        result[number] = item
    return result


def _merged_identity(
    number: int,
    info_tracks: dict[int, dict[str, object]],
    raw_tracks: dict[int, dict[str, object]],
) -> tuple[CraigIdentity | None, bool]:
    info_row = info_tracks.get(number)
    raw_row = raw_tracks.get(number)
    if info_row is None and raw_row is None:
        return None, False

    info_id = _bounded_text(info_row.get("discord_id"), maximum=64) if info_row else None
    raw_id = _bounded_text(raw_row.get("discord_id"), maximum=64) if raw_row else None
    conflict = bool(info_id and raw_id and info_id != raw_id)
    discord_id = None if conflict else (raw_id or info_id)

    username = None
    discriminator = None
    if raw_row:
        username = _bounded_text(raw_row.get("username"), maximum=160)
        discriminator = _bounded_text(raw_row.get("discriminator"), maximum=32)
    if info_row:
        username = username or _bounded_text(info_row.get("username"), maximum=160)
        discriminator = discriminator or _bounded_text(
            info_row.get("discriminator"),
            maximum=32,
        )
    if username is None:
        return None, conflict
    return (
        CraigIdentity(
            username=username,
            discriminator=discriminator,
            discord_id=discord_id,
            global_name=(
                _bounded_text(raw_row.get("global_name"), maximum=160)
                if raw_row
                else None
            ),
            bot=raw_row.get("bot") if raw_row and isinstance(raw_row.get("bot"), bool) else None,
            unknown=(
                raw_row.get("unknown")
                if raw_row and isinstance(raw_row.get("unknown"), bool)
                else None
            ),
        ),
        conflict,
    )


def _metadata_state(
    *,
    info_present: bool,
    raw_parsed: bool,
    compared: int,
    conflicts: int,
) -> str:
    if conflicts:
        return "conflicting"
    if info_present and raw_parsed and compared:
        return "consistent"
    if info_present or raw_parsed:
        return "partial"
    return "unavailable"


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
        plain_tracks: list[tuple[zipfile.ZipInfo, str]] = []
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
            elif plain_flac_speaker(name) is not None:
                if item.file_size <= 0 or item.file_size > MAX_TRACK_BYTES:
                    raise CraigPackageError("CRAIG_TRACK_SIZE_LIMIT")
                plain_tracks.append((item, plain_flac_speaker(name)))
            else:
                raise CraigPackageError("CRAIG_ARCHIVE_UNEXPECTED_FILE")

        if plain_tracks:
            # Do not silently reinterpret a partially malformed Craig export.
            if tracks or info_member is not None or raw_present:
                raise CraigPackageError("CRAIG_ARCHIVE_UNEXPECTED_FILE")
            plain_tracks.sort(key=lambda value: (value[0].filename.casefold(), value[0].filename))
            tracks = [(item, index, speaker) for index, (item, speaker)
                      in enumerate(plain_tracks, start=1)]
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
        raw_warning: str | None = None
        raw_parsed = False
        metadata_warnings: list[str] = []
        metadata_compared = 0
        metadata_conflicts = 0
        with zipfile.ZipFile(source_zip, "r") as archive:
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

            raw_member = next(
                (
                    item
                    for item in archive.infolist()
                    if not item.is_dir() and item.filename.replace("\\", "/").casefold() == "raw.dat"
                ),
                None,
            )
            if raw_member is not None:
                raw_value, raw_warning = _parse_raw_metadata_header(archive, raw_member)
                raw_parsed = raw_value is not None

            info_identity_map = _identity_by_number(info_value)
            raw_identity_map = _identity_by_number(raw_value or {})
            output_tracks: list[CraigTrack] = []
            tracks_root = staging / "tracks"
            tracks_root.mkdir()
            for member, number, speaker in tracks:
                source_filename = _member_name(member)
                physical_filename = physical_track_filename(number)
                target = tracks_root / physical_filename
                digest = _copy_member(archive, member, target)
                identity, identity_conflict = _merged_identity(
                    number,
                    info_identity_map,
                    raw_identity_map,
                )
                info_track_id = (
                    _bounded_text(
                        info_identity_map[number].get("discord_id"),
                        maximum=64,
                    )
                    if number in info_identity_map
                    else None
                )
                raw_track_id = (
                    _bounded_text(
                        raw_identity_map[number].get("discord_id"),
                        maximum=64,
                    )
                    if number in raw_identity_map
                    else None
                )
                if identity_conflict:
                    metadata_warnings.append(f"CRAIG_TRACK_IDENTITY_CONFLICT:{number}")
                    metadata_conflicts += 1
                elif info_track_id and raw_track_id:
                    metadata_compared += 1
                output_tracks.append(
                    CraigTrack(
                        number=number,
                        speaker=speaker,
                        filename=source_filename,
                        path=f"tracks/{physical_filename}",
                        size_bytes=member.file_size,
                        sha256=digest,
                        identity=identity,
                        staged_mtime_ns=target.stat().st_mtime_ns,
                        duration_seconds=flac_duration_seconds(target),
                    )
                )

        strong_fields = (
            (
                "recording_id",
                "CRAIG_RECORDING_ID_CONFLICT",
                lambda value: value,
            ),
            (
                "start_time",
                "CRAIG_START_TIME_CONFLICT",
                _canonical_instant,
            ),
            (
                "guild_id",
                "CRAIG_GUILD_ID_CONFLICT",
                lambda value: value,
            ),
            (
                "channel_id",
                "CRAIG_CHANNEL_ID_CONFLICT",
                lambda value: value,
            ),
            (
                "requester_id",
                "CRAIG_REQUESTER_ID_CONFLICT",
                lambda value: value,
            ),
        )
        merged_strong: dict[str, str | None] = {}
        for key, warning, canonicalize in strong_fields:
            info_field = info_value.get(key)
            raw_field = raw_value.get(key) if raw_value else None
            merged, conflict = _merge_strong_value(
                info_field,
                raw_field,
                canonicalize=canonicalize,
            )
            merged_strong[key] = merged
            if conflict:
                metadata_conflicts += 1
                metadata_warnings.append(warning)
            elif (
                _bounded_text(info_field, maximum=512) is not None
                and _bounded_text(raw_field, maximum=512) is not None
            ):
                metadata_compared += 1

        recording_id = merged_strong["recording_id"]
        start_time = merged_strong["start_time"]
        if raw_warning:
            metadata_warnings.append(raw_warning)

        info_notes = info_value.get("notes")
        notes: list[CraigNote] = []
        if isinstance(info_notes, list):
            for item in info_notes[:MAX_NOTE_COUNT]:
                if not isinstance(item, dict):
                    continue
                offset = item.get("offset_seconds")
                note_text = _bounded_text(item.get("text"), maximum=MAX_NOTE_TEXT)
                if (
                    isinstance(offset, bool)
                    or not isinstance(offset, (int, float))
                    or float(offset) < 0
                    or note_text is None
                ):
                    continue
                notes.append(CraigNote(offset_seconds=float(offset), text=note_text))

        guild = _bounded_text(info_value.get("guild"), maximum=512)
        channel = _bounded_text(info_value.get("channel"), maximum=512)
        requester = _bounded_text(info_value.get("requester"), maximum=512)
        if raw_value:
            guild = guild or _bounded_text(raw_value.get("guild"), maximum=512)
            channel = channel or _bounded_text(raw_value.get("channel"), maximum=512)
            requester = requester or _bounded_text(raw_value.get("requester"), maximum=512)

        package = CraigPackage(
            schema_version="tda_craig_package_v1",
            source_zip=logical_source_name,
            source_sha256=source_sha,
            recording_id=recording_id,
            guild=guild,
            channel=channel,
            requester=requester,
            start_time=_safe_start_time(start_time),
            tracks=tuple(output_tracks),
            info_present=info_present,
            raw_dat_present=raw_present,
            guild_id=merged_strong["guild_id"],
            channel_id=merged_strong["channel_id"],
            requester_id=merged_strong["requester_id"],
            notes=tuple(notes),
            raw_metadata_parsed=raw_parsed,
            export_job_id=_bounded_text(raw_value.get("export_job_id"), maximum=256) if raw_value else None,
            metadata_consistency=_metadata_state(
                info_present=info_present,
                raw_parsed=raw_parsed,
                compared=metadata_compared,
                conflicts=metadata_conflicts,
            ),
            metadata_warnings=tuple(metadata_warnings),
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
