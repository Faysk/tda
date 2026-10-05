from __future__ import annotations

import hashlib
import json
import re

from .asr_models import ModelRegistryError, get_profile

INTENT_FINGERPRINT_SCHEMA = "tda_transcription_intent_fingerprint_v1"
TRANSCRIPTION_RECIPE_VERSION = "tda_transcription_recipe_v1"
DEFAULT_TRACK_POLICY_VERSION = "all_tracks_v1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class TranscriptionIntentFingerprintError(ValueError):
    pass


def _sha(value: str, code: str) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise TranscriptionIntentFingerprintError(code)
    return value


def compatibility_contract(
    *,
    profile_id: str,
    context_sha256: str,
    glossary_sha256: str,
    track_policy_version: str = DEFAULT_TRACK_POLICY_VERSION,
) -> dict[str, object]:
    """Return the versioned semantic contract used to decide exact run reuse.

    This intentionally describes inputs that can change transcript semantics, not
    operational metadata such as job id, attempt, completion time or GPU UUID.
    Bump TRANSCRIPTION_RECIPE_VERSION whenever ASR behavior changes without a
    corresponding profile/model/alignment identity change.
    """
    try:
        profile = get_profile(profile_id)
    except ModelRegistryError as exc:
        raise TranscriptionIntentFingerprintError(
            "TRANSCRIPTION_INTENT_PROFILE_INVALID"
        ) from exc
    if (
        not isinstance(track_policy_version, str)
        or not track_policy_version
        or len(track_policy_version) > 96
        or re.fullmatch(r"[a-z0-9._-]+", track_policy_version) is None
    ):
        raise TranscriptionIntentFingerprintError(
            "TRANSCRIPTION_INTENT_TRACK_POLICY_INVALID"
        )
    return {
        "schema_version": INTENT_FINGERPRINT_SCHEMA,
        "recipe_version": TRANSCRIPTION_RECIPE_VERSION,
        "track_policy_version": track_policy_version,
        "profile": {
            "id": profile.id,
            "engine": profile.engine,
            "model": profile.model_id,
            "model_revision": profile.revision,
            "language": profile.language,
            "alignment": profile.alignment,
            "alignment_revision": profile.alignment_revision,
        },
        "context_sha256": _sha(
            context_sha256,
            "TRANSCRIPTION_INTENT_CONTEXT_HASH_INVALID",
        ),
        "glossary_sha256": _sha(
            glossary_sha256,
            "TRANSCRIPTION_INTENT_GLOSSARY_HASH_INVALID",
        ),
    }


def compatibility_fingerprint(
    *,
    profile_id: str,
    context_sha256: str,
    glossary_sha256: str,
    track_policy_version: str = DEFAULT_TRACK_POLICY_VERSION,
) -> str:
    contract = compatibility_contract(
        profile_id=profile_id,
        context_sha256=context_sha256,
        glossary_sha256=glossary_sha256,
        track_policy_version=track_policy_version,
    )
    encoded = json.dumps(
        contract,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def fingerprint_for_run_manifest(value: dict[str, object]) -> str | None:
    """Return a persisted exact fingerprint only after validating its shape.

    Historical manifests intentionally return None. We do not reconstruct an
    exact fingerprint from partial legacy metadata because that would turn
    unknown recipe/alignment inputs into a false proof of equivalence.
    """
    schema = value.get("intent_fingerprint_schema")
    fingerprint = value.get("intent_fingerprint")
    if schema is None and fingerprint is None:
        return None
    if schema != INTENT_FINGERPRINT_SCHEMA:
        raise TranscriptionIntentFingerprintError(
            "TRANSCRIPTION_RUN_INTENT_FINGERPRINT_INVALID"
        )
    if not isinstance(fingerprint, str) or _SHA256.fullmatch(fingerprint) is None:
        raise TranscriptionIntentFingerprintError(
            "TRANSCRIPTION_RUN_INTENT_FINGERPRINT_INVALID"
        )
    return fingerprint
