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
from uuid import uuid4

from .flac_metadata import flac_duration_seconds

TRACK_NAME = re.compile(r"^(?P<track>[1-9][0-9]*)-(?P<speaker>.+)\.flac$", re.IGNORECASE)
MAX_ENTRIES = 256
MAX_INFO_BYTES = 1024 * 1024
MAX_RAW_HEADER_BYTES = 256 * 1024
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
    raw_metadata_present: bool = False
    metadata_consistency: str = "unavailable"
    metadata_warnings: tuple[str, ...] = ()

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


def _clean_metadata_text(value: object, *, maximum: int = 512) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > maximum or "\x00" in text:
        return None
    return text


def _parse_note_line(value: str) -> dict[str, object] | None:
    match = re.fullmatch(
        r"(?P<hours>[0-9]+):(?P<minutes>[0-5][0-9]):(?P<seconds>[0-5][0-9]):\s*(?P<text>.+)",
        value.strip(),
    )
    if match is None:
        return None
    text = _clean_metadata_text(match.group("text"), maximum=4096)
    if text is None:
        return None
    offset = (
        int(match.group("hours")) * 3600
        + int(match.group("minutes")) * 60
        + int(match.group("seconds"))
    )
    return {"offset_seconds": float(offset), "text": text}


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

        if in_notes:
            note = _parse_note_line(stripped)
            if note is not None:
                notes = value["notes"]
                assert isinstance(notes, list)
                notes.append(note)
            continue

        matched_label = False
        for prefix, key in labels.items():
            if stripped.startswith(prefix):
                value[key] = stripped[len(prefix) :].strip() or None
                matched_label = True
                in_tracks = False
                break
        if matched_label or not in_tracks:
            continue

        # Newer exported info may carry an explicit user id in parentheses.
        identity = re.match(
            r"^(?P<name>.+?)(?:#(?P<disc>[^\s()]+))?\s+\((?P<id>[^()]+)\)$",
            stripped,
        )
        # Older Craig infotxt output contains username#discriminator only.
        if identity is None:
            identity = re.match(
                r"^(?P<name>.+?)(?:#(?P<disc>[^\s()]+))?$",
                stripped,
            )
        if identity:
            tracks = value["tracks"]
            assert isinstance(tracks, list)
            groups = identity.groupdict()
            tracks.append(
                {
                    "username": identity.group("name").strip(),
                    "discriminator": groups.get("disc"),
                    "discord_id": (
                        groups.get("id").strip()
                        if isinstance(groups.get("id"), str) and groups.get("id").strip()
                        else None
                    ),
                }
            )
    return value


def _read_raw_dat_header(
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo | None,
) -> tuple[dict[str, object] | None, str | None]:
    """Read only Craig's bounded JSON metadata prefix from raw.dat."""
    if member is None:
        return None, None
    try:
        with archive.open(member, "r") as handle:
            line = handle.readline(MAX_RAW_HEADER_BYTES + 1)
    except (OSError, RuntimeError, zipfile.BadZipFile):
        return None, "CRAIG_RAW_HEADER_READ_FAILED"
    if not line or len(line) > MAX_RAW_HEADER_BYTES or not line.endswith(b"\n"):
        return None, "CRAIG_RAW_HEADER_INVALID"
    try:
        decoded = line.decode("utf-8")
        value = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "CRAIG_RAW_HEADER_INVALID"
    if not isinstance(value, dict):
        return None, "CRAIG_RAW_HEADER_INVALID"
    return value, None


def _raw_tracks(value: dict[str, object] | None) -> dict[int, dict[str, object]]:
    if value is None:
        return {}
    raw = value.get("tracks")
    rows: list[tuple[object, object]]
    if isinstance(raw, dict):
        rows = list(raw.items())
    elif isinstance(raw, list):
        rows = [(None, item) for item in raw]
    else:
        return {}

    result: dict[int, dict[str, object]] = {}
    for key, item in rows:
        if not isinstance(item, dict):
            continue
        number_value = item.get("track", key)
        try:
            number = int(number_value) if not isinstance(number_value, bool) else 0
        except (TypeError, ValueError):
            number = 0
        if number < 1 or number > 1_000_000 or number in result:
            continue
        username = _clean_metadata_text(item.get("username"), maximum=160)
        discord_id = _clean_metadata_text(item.get("id"), maximum=128)
        if username is None and discord_id is None:
            continue
        result[number] = {
            "username": username,
            "discriminator": _clean_metadata_text(item.get("discriminator"), maximum=64),
            "discord_id": discord_id,
            "global_name": _clean_metadata_text(item.get("globalName"), maximum=160),
            "bot": item.get("bot") if isinstance(item.get("bot"), bool) else None,
            "unknown": item.get("unknown") if isinstance(item.get("unknown"), bool) else None,
        }
    return result


def _raw_extra_id(value: dict[str, object] | None, key: str) -> str | None:
    if value is None:
        return None
    extra = value.get(key)
    if not isinstance(extra, dict):
        return None
    return _clean_metadata_text(extra.get("id"), maximum=128)


def _raw_extra_name(value: dict[str, object] | None, key: str) -> str | None:
    if value is None:
        return None
    extra = value.get(key)
    if not isinstance(extra, dict):
        return None
    return _clean_metadata_text(extra.get("name"), maximum=512)


def _raw_requester_name(value: dict[str, object] | None) -> str | None:
    if value is None:
        return None
    extra = value.get("requesterExtra")
    if isinstance(extra, dict):
        username = _clean_metadata_text(extra.get("username"), maximum=160)
        global_name = _clean_metadata_text(extra.get("globalName"), maximum=160)
        if global_name:
            return global_name
        if username:
            return username
    return _clean_metadata_text(value.get("requester"), maximum=512)


def _instant(value: object) -> datetime | None:
    text = _clean_metadata_text(value, maximum=128)
    if text is None:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def _times_equivalent(left: object, right: object) -> bool:
    a = _instant(left)
    b = _instant(right)
    if a is not None and b is not None:
        return a == b
    return left == right


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


def inspect_craig_zip(
    source_zip: Path,
) -> tuple[
    list[tuple[zipfile.ZipInfo, int, str]],
    zipfile.ZipInfo | None,
    zipfile.ZipInfo | None,
]:
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
        raw_member: zipfile.ZipInfo | None = None
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
                raw_member = item
            else:
                raise CraigPackageError("CRAIG_ARCHIVE_UNEXPECTED_FILE")

        if not tracks:
            raise CraigPackageError("CRAIG_ARCHIVE_NO_TRACKS")
        tracks.sort(key=lambda value: value[1])
        return tracks, info_member, raw_member


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
    tracks, info_member, raw_member = inspect_craig_zip(source_zip)
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
        raw_present = raw_member is not None
        raw_value: dict[str, object] | None = None
        raw_warning: str | None = None
        with zipfile.ZipFile(source_zip, "r") as archive:
            raw_value, raw_warning = _read_raw_dat_header(archive, raw_member)
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

            identities = info_value.get("tracks")
            info_tracks = identities if isinstance(identities, list) else []
            raw_tracks = _raw_tracks(raw_value)
            warnings: list[str] = []
            if raw_warning is not None:
                warnings.append(raw_warning)

            info_recording_id = _clean_metadata_text(info_value.get("recording_id"), maximum=256)
            raw_recording_id = _clean_metadata_text(
                raw_value.get("id") if raw_value is not None else None,
                maximum=256,
            )
            if info_recording_id and raw_recording_id and info_recording_id != raw_recording_id:
                warnings.append("CRAIG_METADATA_RECORDING_ID_CONFLICT")

            info_start = _clean_metadata_text(info_value.get("start_time"), maximum=128)
            raw_start = _clean_metadata_text(
                raw_value.get("startTime") if raw_value is not None else None,
                maximum=128,
            )
            if info_start and raw_start and not _times_equivalent(info_start, raw_start):
                warnings.append("CRAIG_METADATA_START_TIME_CONFLICT")

            output_tracks: list[CraigTrack] = []
            tracks_root = staging / "tracks"
            tracks_root.mkdir()
            for index, (member, number, speaker) in enumerate(tracks):
                source_filename = _member_name(member)
                physical_filename = physical_track_filename(number)
                target = tracks_root / physical_filename
                digest = _copy_member(archive, member, target)

                info_row = (
                    info_tracks[index]
                    if index < len(info_tracks) and isinstance(info_tracks[index], dict)
                    else {}
                )
                raw_row = raw_tracks.get(number, {})
                info_discord = _clean_metadata_text(info_row.get("discord_id"), maximum=128)
                raw_discord = _clean_metadata_text(raw_row.get("discord_id"), maximum=128)
                if info_discord and raw_discord and info_discord != raw_discord:
                    warnings.append(f"CRAIG_METADATA_TRACK_ID_CONFLICT:{number}")

                username = (
                    _clean_metadata_text(raw_row.get("username"), maximum=160)
                    or _clean_metadata_text(info_row.get("username"), maximum=160)
                )
                identity = None
                if username is not None or raw_discord is not None or info_discord is not None:
                    identity = CraigIdentity(
                        username=username or speaker,
                        discriminator=(
                            _clean_metadata_text(raw_row.get("discriminator"), maximum=64)
                            or _clean_metadata_text(info_row.get("discriminator"), maximum=64)
                        ),
                        discord_id=raw_discord or info_discord,
                        global_name=_clean_metadata_text(raw_row.get("global_name"), maximum=160),
                        bot=raw_row.get("bot") if isinstance(raw_row.get("bot"), bool) else None,
                        unknown=(
                            raw_row.get("unknown")
                            if isinstance(raw_row.get("unknown"), bool)
                            else None
                        ),
                    )
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

        raw_available = raw_value is not None
        if warnings:
            metadata_consistency = (
                "conflicting"
                if any("CONFLICT" in warning for warning in warnings)
                else "raw_invalid"
            )
        elif info_present and raw_available:
            metadata_consistency = "consistent"
        elif info_present or raw_available:
            metadata_consistency = "partial"
        else:
            metadata_consistency = "unavailable"

        notes_value = info_value.get("notes")
        notes: list[CraigNote] = []
        if isinstance(notes_value, list):
            for row in notes_value:
                if not isinstance(row, dict):
                    continue
                offset = row.get("offset_seconds")
                text = _clean_metadata_text(row.get("text"), maximum=4096)
                if isinstance(offset, (int, float)) and not isinstance(offset, bool) and offset >= 0 and text:
                    notes.append(CraigNote(offset_seconds=float(offset), text=text))

        package = CraigPackage(
            schema_version="tda_craig_package_v1",
            source_zip=logical_source_name,
            source_sha256=source_sha,
            recording_id=info_recording_id or raw_recording_id,
            guild=(
                _clean_metadata_text(info_value.get("guild"), maximum=512)
                or _raw_extra_name(raw_value, "guildExtra")
                or _clean_metadata_text(raw_value.get("guild") if raw_value is not None else None, maximum=512)
            ),
            channel=(
                _clean_metadata_text(info_value.get("channel"), maximum=512)
                or _raw_extra_name(raw_value, "channelExtra")
                or _clean_metadata_text(raw_value.get("channel") if raw_value is not None else None, maximum=512)
            ),
            requester=(
                _clean_metadata_text(info_value.get("requester"), maximum=512)
                or _raw_requester_name(raw_value)
            ),
            start_time=_safe_start_time(info_start or raw_start),
            tracks=tuple(output_tracks),
            info_present=info_present,
            raw_dat_present=raw_present,
            guild_id=_raw_extra_id(raw_value, "guildExtra"),
            channel_id=_raw_extra_id(raw_value, "channelExtra"),
            requester_id=_clean_metadata_text(
                raw_value.get("requesterId") if raw_value is not None else None,
                maximum=128,
            ),
            notes=tuple(notes),
            raw_metadata_present=raw_available,
            metadata_consistency=metadata_consistency,
            metadata_warnings=tuple(sorted(set(warnings))),
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
