from __future__ import annotations

import hashlib
import io

import pytest

from tda_companion.release_download import ReleaseRedirectError
from tda_companion.updates import UpdateManifest, download_update


def _manifest(payload: bytes) -> UpdateManifest:
    return UpdateManifest(
        version="0.3.2",
        tag="companion-v0.3.2",
        minimum_api="1",
        url="https://dnd.faysk.dev/api/downloads/companion/windows",
        sha256=hashlib.sha256(payload).hexdigest(),
        size=len(payload),
    )


def test_download_update_uses_verified_release_chain(monkeypatch, tmp_path):
    payload = b"fake-msi-payload"
    manifest = _manifest(payload)
    seen: dict[str, object] = {}

    def fake_open(request, *, expected_github_url: str, timeout: float):
        seen["request_url"] = request.full_url
        seen["expected_github_url"] = expected_github_url
        seen["timeout"] = timeout
        return io.BytesIO(payload)

    monkeypatch.setattr("tda_companion.updates.open_verified_release", fake_open)

    target = download_update(manifest, tmp_path, timeout=12.5)

    assert target.read_bytes() == payload
    assert seen == {
        "request_url": manifest.url,
        "expected_github_url": (
            "https://github.com/Faysk/tda/releases/download/companion-v0.3.2/"
            "TDACompanion-x64.msi"
        ),
        "timeout": 12.5,
    }
    assert not target.with_suffix(".partial").exists()


def test_download_update_maps_rejected_release_chain_to_stable_error(monkeypatch, tmp_path):
    manifest = _manifest(b"fake-msi-payload")

    def reject(*args, **kwargs):  # noqa: ANN002, ANN003
        raise ReleaseRedirectError("RELEASE_REDIRECT_REJECTED")

    monkeypatch.setattr("tda_companion.updates.open_verified_release", reject)

    with pytest.raises(RuntimeError, match="^UPDATE_REDIRECT_REJECTED$"):
        download_update(manifest, tmp_path)

    target = tmp_path / "updates" / manifest.version / "TDACompanion-x64.msi"
    assert not target.exists()
    assert not target.with_suffix(".partial").exists()
