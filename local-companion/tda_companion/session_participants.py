from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from typing import Mapping

PARTICIPANT_MAPPING_SCHEMA_VERSION = "tda_session_participant_mapping_v1"
PARTICIPANT_MAPPING_POLICY = "strong_discord_or_manual_v1"
_HEX32 = re.compile(r"^[0-9a-f]{32}$")


def _participant_id(
    campaign_id: str,
    session_id: str,
    authority: str,
) -> str:
    digest = hashlib.sha256(
        f"{campaign_id}\0{session_id}\0{authority}".encode("utf-8")
    ).hexdigest()
    return digest[:32]


def _observation_id(source_id: str, track_number: int) -> str:
    return hashlib.sha256(
        f"{source_id}\0{track_number}".encode("utf-8")
    ).hexdigest()[:32]


def _clean_optional_text(value: object, *, limit: int = 256) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > limit or "\x00" in text:
        return None
    return text


def _auxiliary_label(observation: Mapping[str, object]) -> str | None:
    value = observation.get("username") or observation.get("raw_speaker")
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).casefold()
    return normalized or None


def observed_session_tracks(
    workspace: Mapping[str, object],
    packages_by_source: Mapping[str, object | None],
) -> list[dict[str, object]]:
    if workspace.get("schema_version") != "tda_session_workspace_v1":
        raise ValueError("SESSION_PARTICIPANTS_WORKSPACE_INVALID")
    parts = workspace.get("parts")
    if not isinstance(parts, list) or len(parts) > 64:
        raise ValueError("SESSION_PARTICIPANTS_WORKSPACE_INVALID")

    observations: list[dict[str, object]] = []
    for part in parts:
        if not isinstance(part, Mapping):
            raise ValueError("SESSION_PARTICIPANTS_WORKSPACE_INVALID")
        part_id = part.get("part_id")
        source_id = part.get("source_id")
        ordinal = part.get("ordinal")
        if (
            not isinstance(part_id, str)
            or not _HEX32.fullmatch(part_id)
            or not isinstance(source_id, str)
            or not re.fullmatch(r"craig-[0-9a-f]{64}", source_id)
            or isinstance(ordinal, bool)
            or not isinstance(ordinal, int)
            or ordinal < 0
        ):
            raise ValueError("SESSION_PARTICIPANTS_WORKSPACE_INVALID")
        package = packages_by_source.get(source_id)
        tracks = getattr(package, "tracks", None) if package is not None else None
        if tracks is None:
            continue
        if not isinstance(tracks, (list, tuple)) or len(tracks) > 256:
            raise ValueError("SESSION_PARTICIPANTS_SOURCE_INVALID")
        for track in tracks:
            number = getattr(track, "number", None)
            if (
                isinstance(number, bool)
                or not isinstance(number, int)
                or number < 1
                or number > 1_000_000
            ):
                raise ValueError("SESSION_PARTICIPANTS_SOURCE_INVALID")
            identity = getattr(track, "identity", None)
            raw_speaker = _clean_optional_text(getattr(track, "speaker", None)) or "Track"
            username = _clean_optional_text(
                getattr(identity, "username", None) if identity is not None else None
            )
            discriminator = _clean_optional_text(
                getattr(identity, "discriminator", None) if identity is not None else None,
                limit=64,
            )
            discord_id = _clean_optional_text(
                getattr(identity, "discord_id", None) if identity is not None else None,
                limit=128,
            )
            observations.append(
                {
                    "observation_id": _observation_id(source_id, number),
                    "part_id": part_id,
                    "source_id": source_id,
                    "part_ordinal": ordinal,
                    "track_number": number,
                    "raw_speaker": raw_speaker,
                    "username": username,
                    "discriminator": discriminator,
                    "discord_id": discord_id,
                }
            )

    observations.sort(
        key=lambda row: (
            int(row["part_ordinal"]),
            int(row["track_number"]),
            str(row["source_id"]),
            str(row["observation_id"]),
        )
    )
    if len({row["observation_id"] for row in observations}) != len(observations):
        raise ValueError("SESSION_PARTICIPANTS_OBSERVATION_COLLISION")
    return observations


def resolve_session_participants(
    workspace: Mapping[str, object],
    packages_by_source: Mapping[str, object | None],
    manual_assignments: Mapping[str, str] | None = None,
) -> dict[str, object]:
    campaign_id = workspace.get("campaign_id")
    session_id = workspace.get("session_id")
    revision = workspace.get("revision")
    if (
        not isinstance(campaign_id, str)
        or not isinstance(session_id, str)
        or isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 0
    ):
        raise ValueError("SESSION_PARTICIPANTS_WORKSPACE_INVALID")

    observations = observed_session_tracks(workspace, packages_by_source)
    observation_ids = {str(row["observation_id"]) for row in observations}
    assignments: dict[str, str] = {}
    for observation_id, participant_id in (manual_assignments or {}).items():
        if (
            observation_id not in observation_ids
            or not isinstance(participant_id, str)
            or not _HEX32.fullmatch(participant_id)
        ):
            raise ValueError("SESSION_PARTICIPANTS_MAPPING_INVALID")
        assignments[observation_id] = participant_id

    groups: dict[str, list[dict[str, object]]] = defaultdict(list)
    participant_authorities: dict[str, str] = {}
    for observation in observations:
        observation_id = str(observation["observation_id"])
        if observation_id in assignments:
            participant_id = assignments[observation_id]
            authority = "manual"
        elif observation["discord_id"] is not None:
            authority_key = f"discord:{observation['discord_id']}"
            participant_id = _participant_id(campaign_id, session_id, authority_key)
            authority = "discord_id"
        else:
            authority_key = f"observation:{observation_id}"
            participant_id = _participant_id(campaign_id, session_id, authority_key)
            authority = "local_observation"
        groups[participant_id].append(observation)
        current = participant_authorities.get(participant_id)
        participant_authorities[participant_id] = (
            "manual" if current == "manual" or authority == "manual" else authority
        )

    conflicts: list[dict[str, object]] = []
    approval_blocked = False

    observed_sources = {str(row["source_id"]) for row in observations}
    for part in workspace["parts"]:
        source_id = str(part["source_id"])
        if source_id not in observed_sources:
            conflicts.append(
                {
                    "code": "SOURCE_IDENTITY_UNAVAILABLE",
                    "severity": "error",
                    "requires_resolution": True,
                    "observation_ids": [],
                    "source_id": source_id,
                }
            )
            approval_blocked = True

    observation_participants = {
        str(observation["observation_id"]): participant_id
        for participant_id, grouped in groups.items()
        for observation in grouped
    }

    by_discord: dict[str, list[dict[str, object]]] = defaultdict(list)
    by_label: dict[str, list[dict[str, object]]] = defaultdict(list)
    by_track_number: dict[int, list[dict[str, object]]] = defaultdict(list)
    for observation in observations:
        discord_id = observation["discord_id"]
        if isinstance(discord_id, str):
            by_discord[discord_id].append(observation)
        label = _auxiliary_label(observation)
        if label is not None:
            by_label[label].append(observation)
        by_track_number[int(observation["track_number"])].append(observation)

    for discord_id, rows in sorted(by_discord.items()):
        source_ids = {str(row["source_id"]) for row in rows}
        labels = {
            label
            for row in rows
            if (label := _auxiliary_label(row)) is not None
        }
        if len(source_ids) > 1 and len(labels) > 1:
            conflicts.append(
                {
                    "code": "DISCORD_LABEL_DRIFT",
                    "severity": "warning",
                    "requires_resolution": False,
                    "observation_ids": sorted(str(row["observation_id"]) for row in rows),
                    "discord_id": discord_id,
                }
            )

    for label, rows in sorted(by_label.items()):
        source_ids = {str(row["source_id"]) for row in rows}
        if len(source_ids) <= 1:
            continue
        if all(str(row["observation_id"]) in assignments for row in rows):
            continue
        discord_ids = {
            str(row["discord_id"])
            for row in rows
            if row["discord_id"] is not None
        }
        if len(discord_ids) > 1:
            conflicts.append(
                {
                    "code": "LABEL_MULTIPLE_DISCORD_IDS",
                    "severity": "warning",
                    "requires_resolution": False,
                    "observation_ids": sorted(str(row["observation_id"]) for row in rows),
                    "label_key": label,
                }
            )
            continue
        if len(discord_ids) == 1 and all(
            row["discord_id"] is not None for row in rows
        ):
            continue
        # A textual label is only auxiliary evidence. Keep each weak observation
        # source-local instead of forcing the operator to decide whether similarly
        # named tracks are the same human. The transcript remains attributable to
        # the exact source/track and can be merged manually later if useful.
        conflicts.append(
            {
                "code": (
                    "LABEL_PARTIAL_IDENTITY"
                    if len(discord_ids) == 1
                    else "LABEL_ONLY_CROSS_SOURCE_AMBIGUOUS"
                ),
                "severity": "warning",
                "requires_resolution": False,
                "observation_ids": sorted(str(row["observation_id"]) for row in rows),
                "label_key": label,
            }
        )

    for track_number, rows in sorted(by_track_number.items()):
        source_ids = {str(row["source_id"]) for row in rows}
        if len(source_ids) <= 1:
            continue
        participant_ids = {
            observation_participants[str(row["observation_id"])]
            for row in rows
        }
        if len(participant_ids) > 1:
            conflicts.append(
                {
                    "code": "TRACK_NUMBER_REUSED",
                    "severity": "info",
                    "requires_resolution": False,
                    "observation_ids": sorted(str(row["observation_id"]) for row in rows),
                    "track_number": track_number,
                }
            )

    participants = []
    for participant_id, rows in sorted(groups.items()):
        rows = sorted(
            rows,
            key=lambda row: (
                int(row["part_ordinal"]),
                int(row["track_number"]),
                str(row["observation_id"]),
            ),
        )
        authority = participant_authorities[participant_id]
        participants.append(
            {
                "participant_id": participant_id,
                "resolution": authority,
                "profile_id": None,
                "display_speaker": str(rows[0]["raw_speaker"]),
                "observation_ids": [str(row["observation_id"]) for row in rows],
            }
        )

    canonical = {
        "schema_version": PARTICIPANT_MAPPING_SCHEMA_VERSION,
        "policy": PARTICIPANT_MAPPING_POLICY,
        "campaign_id": campaign_id,
        "session_id": session_id,
        "observations": [
            {
                "observation_id": row["observation_id"],
                "source_id": row["source_id"],
                "track_number": row["track_number"],
                "raw_speaker": row["raw_speaker"],
                "username": row["username"],
                "discriminator": row["discriminator"],
                "discord_id": row["discord_id"],
            }
            for row in observations
        ],
        "assignments": sorted(assignments.items()),
        "participants": [
            {
                "participant_id": row["participant_id"],
                "resolution": row["resolution"],
                "observation_ids": row["observation_ids"],
            }
            for row in participants
        ],
    }
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

    return {
        "schema_version": PARTICIPANT_MAPPING_SCHEMA_VERSION,
        "policy": PARTICIPANT_MAPPING_POLICY,
        "campaign_id": campaign_id,
        "session_id": session_id,
        "workspace_revision": revision,
        "mapping_sha256": hashlib.sha256(encoded).hexdigest(),
        "approval_blocked": approval_blocked,
        "observations": observations,
        "participants": participants,
        "conflicts": conflicts,
        "manual_assignments": [
            {
                "observation_id": observation_id,
                "participant_id": participant_id,
            }
            for observation_id, participant_id in sorted(assignments.items())
        ],
    }
