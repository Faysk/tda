from __future__ import annotations

from types import SimpleNamespace

from tda_companion.session_participants import resolve_session_participants


def source(seed: str) -> str:
    return "craig-" + seed * 64


def identity(
    *,
    username: str | None = None,
    discriminator: str | None = None,
    discord_id: str | None = None,
):
    return SimpleNamespace(
        username=username,
        discriminator=discriminator,
        discord_id=discord_id,
    )


def track(
    number: int,
    speaker: str,
    *,
    username: str | None = None,
    discriminator: str | None = None,
    discord_id: str | None = None,
):
    return SimpleNamespace(
        number=number,
        speaker=speaker,
        identity=identity(
            username=username,
            discriminator=discriminator,
            discord_id=discord_id,
        ),
    )


def package(*tracks):
    return SimpleNamespace(tracks=tracks)


def part(part_id: str, source_id: str, ordinal: int):
    return {
        "part_id": part_id,
        "source_id": source_id,
        "ordinal": ordinal,
    }


def workspace(parts, revision=2):
    return {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "yuhara-main",
        "session_id": "session-42",
        "revision": revision,
        "parts": parts,
    }


def observation_by_source(result, source_id):
    return [
        row for row in result["observations"] if row["source_id"] == source_id
    ]


def participant_for_observation(result, observation_id):
    matches = [
        participant
        for participant in result["participants"]
        if observation_id in participant["observation_ids"]
    ]
    assert len(matches) == 1
    return matches[0]


def test_reconnect_track_numbers_can_swap_without_swapping_people():
    a = source("a")
    b = source("b")
    value = workspace(
        [
            part("1" * 32, a, 0),
            part("2" * 32, b, 1),
        ]
    )
    result = resolve_session_participants(
        value,
        {
            a: package(
                track(1, "Renan", username="Renan", discord_id="111"),
                track(2, "Thom", username="Thom", discord_id="222"),
            ),
            b: package(
                track(1, "Thom", username="Thom", discord_id="222"),
                track(2, "Renan", username="Renan", discord_id="111"),
            ),
        },
    )

    a_rows = observation_by_source(result, a)
    b_rows = observation_by_source(result, b)
    a_renan = next(row for row in a_rows if row["discord_id"] == "111")
    b_renan = next(row for row in b_rows if row["discord_id"] == "111")
    a_thom = next(row for row in a_rows if row["discord_id"] == "222")
    b_thom = next(row for row in b_rows if row["discord_id"] == "222")

    assert a_renan["track_number"] == 1
    assert b_renan["track_number"] == 2
    assert a_thom["track_number"] == 2
    assert b_thom["track_number"] == 1
    assert (
        participant_for_observation(result, a_renan["observation_id"])["participant_id"]
        == participant_for_observation(result, b_renan["observation_id"])["participant_id"]
    )
    assert (
        participant_for_observation(result, a_thom["observation_id"])["participant_id"]
        == participant_for_observation(result, b_thom["observation_id"])["participant_id"]
    )
    assert result["approval_blocked"] is False
    assert any(
        conflict["code"] == "TRACK_NUMBER_REUSED"
        for conflict in result["conflicts"]
    )


def test_same_discord_id_with_label_change_is_strong_match_and_visible_drift():
    a = source("a")
    b = source("b")
    result = resolve_session_participants(
        workspace([part("1" * 32, a, 0), part("2" * 32, b, 1)]),
        {
            a: package(track(1, "Renan", username="Renan", discord_id="111")),
            b: package(track(8, "Faysk", username="Faysk", discord_id="111")),
        },
    )

    assert len(result["participants"]) == 1
    assert result["participants"][0]["resolution"] == "discord_id"
    assert result["participants"][0]["profile_id"] is None
    assert result["approval_blocked"] is False
    assert [conflict["code"] for conflict in result["conflicts"]] == [
        "DISCORD_LABEL_DRIFT"
    ]


def test_same_label_with_distinct_discord_ids_never_merges_or_infers_profile():
    a = source("a")
    b = source("b")
    result = resolve_session_participants(
        workspace([part("1" * 32, a, 0), part("2" * 32, b, 1)]),
        {
            a: package(track(1, "Alex", username="Alex", discord_id="111")),
            b: package(track(7, "Alex", username="Alex", discord_id="222")),
        },
    )

    assert len(result["participants"]) == 2
    assert len({row["participant_id"] for row in result["participants"]}) == 2
    assert all(row["profile_id"] is None for row in result["participants"])
    assert result["approval_blocked"] is False
    assert any(
        conflict["code"] == "LABEL_MULTIPLE_DISCORD_IDS"
        for conflict in result["conflicts"]
    )


def test_partial_identity_with_same_label_stays_source_local_until_optional_manual_resolution():
    a = source("a")
    b = source("b")
    value = workspace([part("1" * 32, a, 0), part("2" * 32, b, 1)])
    packages = {
        a: package(track(1, "Renan", username="Renan", discord_id="111")),
        b: package(track(4, "Renan", username="Renan")),
    }

    unresolved = resolve_session_participants(value, packages)
    assert unresolved["approval_blocked"] is False
    conflict = next(
        conflict
        for conflict in unresolved["conflicts"]
        if conflict["code"] == "LABEL_PARTIAL_IDENTITY"
    )
    assert conflict["severity"] == "warning"
    assert conflict["requires_resolution"] is False
    assert len(unresolved["participants"]) == 2

    observations = unresolved["observations"]
    strong = next(row for row in observations if row["discord_id"] == "111")
    weak = next(row for row in observations if row["discord_id"] is None)
    strong_participant = participant_for_observation(
        unresolved, strong["observation_id"]
    )["participant_id"]
    resolved = resolve_session_participants(
        value,
        packages,
        {
            strong["observation_id"]: strong_participant,
            weak["observation_id"]: strong_participant,
        },
    )
    assert resolved["approval_blocked"] is False
    assert len(resolved["participants"]) == 1
    assert resolved["participants"][0]["resolution"] == "manual"
    assert resolved["participants"][0]["profile_id"] is None
    assert resolved["mapping_sha256"] != unresolved["mapping_sha256"]


def test_label_only_cross_source_match_stays_separate_without_blocking_assembly():
    a = source("a")
    b = source("b")
    value = workspace([part("1" * 32, a, 0), part("2" * 32, b, 1)])
    packages = {
        a: package(track(1, "Guest", username="Guest")),
        b: package(track(9, "Guest", username="Guest")),
    }
    unresolved = resolve_session_participants(value, packages)
    assert unresolved["approval_blocked"] is False
    assert len(unresolved["participants"]) == 2
    conflict = next(
        conflict
        for conflict in unresolved["conflicts"]
        if conflict["code"] == "LABEL_ONLY_CROSS_SOURCE_AMBIGUOUS"
    )
    assert conflict["severity"] == "warning"
    assert conflict["requires_resolution"] is False

    observations = unresolved["observations"]
    merged_id = "a" * 32
    merged = resolve_session_participants(
        value,
        packages,
        {row["observation_id"]: merged_id for row in observations},
    )
    assert merged["approval_blocked"] is False
    assert len(merged["participants"]) == 1

    split = resolve_session_participants(
        value,
        packages,
        {
            observations[0]["observation_id"]: "b" * 32,
            observations[1]["observation_id"]: "c" * 32,
        },
    )
    assert split["approval_blocked"] is False
    assert len(split["participants"]) == 2


def test_guest_present_only_in_part_b_remains_local_participant_without_profile():
    a = source("a")
    b = source("b")
    result = resolve_session_participants(
        workspace([part("1" * 32, a, 0), part("2" * 32, b, 1)]),
        {
            a: package(track(1, "Renan", username="Renan", discord_id="111")),
            b: package(
                track(1, "Renan", username="Renan", discord_id="111"),
                track(2, "Convidada", username="Convidada"),
            ),
        },
    )

    guest_observation = next(
        row for row in result["observations"] if row["raw_speaker"] == "Convidada"
    )
    guest = participant_for_observation(result, guest_observation["observation_id"])
    assert guest["resolution"] == "local_observation"
    assert guest["profile_id"] is None
    assert result["approval_blocked"] is False


def test_similar_names_are_not_fuzzy_matched():
    a = source("a")
    b = source("b")
    result = resolve_session_participants(
        workspace([part("1" * 32, a, 0), part("2" * 32, b, 1)]),
        {
            a: package(track(1, "Ana", username="Ana")),
            b: package(track(2, "Anna", username="Anna")),
        },
    )
    assert len(result["participants"]) == 2
    assert result["approval_blocked"] is False
    assert all(row["profile_id"] is None for row in result["participants"])


def test_single_source_does_not_introduce_cross_part_resolution_step():
    a = source("a")
    result = resolve_session_participants(
        workspace([part("1" * 32, a, 0)], revision=1),
        {
            a: package(
                track(1, "Renan", username="Renan"),
                track(2, "Thom", username="Thom"),
            )
        },
    )
    assert result["approval_blocked"] is False
    assert result["conflicts"] == []
    assert len(result["participants"]) == 2


def test_mapping_hash_is_deterministic_and_changes_with_manual_mapping():
    a = source("a")
    b = source("b")
    value = workspace([part("1" * 32, a, 0), part("2" * 32, b, 1)])
    packages = {
        a: package(track(1, "Guest", username="Guest")),
        b: package(track(2, "Guest", username="Guest")),
    }
    first = resolve_session_participants(value, packages)
    repeated = resolve_session_participants(value, packages)
    assert first["mapping_sha256"] == repeated["mapping_sha256"]

    observations = first["observations"]
    changed = resolve_session_participants(
        value,
        packages,
        {row["observation_id"]: "d" * 32 for row in observations},
    )
    assert changed["mapping_sha256"] != first["mapping_sha256"]
