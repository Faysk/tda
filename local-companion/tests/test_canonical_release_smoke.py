from __future__ import annotations

import io
import json
import textwrap
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[2]
BASE = "https://dnd.faysk.dev"
MANIFEST = BASE + "/api/downloads/companion/windows/manifest"
TAG = "companion-v0.3.15"
DOWNLOAD = f"https://github.com/Faysk/tda/releases/download/{TAG}/TDACompanion-x64.msi"


def _smoke_source():
    workflow = (REPO / ".github/workflows/companion-promote.yml").read_text(encoding="utf-8")
    step = workflow.split("- name: Verify canonical Web resolves promoted Stable\n", 1)[1]
    return textwrap.dedent(step.split("python - <<'PY'\n", 1)[1].split("          PY\n", 1)[0])


def _run(monkeypatch, *, status=200, final_url=MANIFEST, redirect=False, download_status=307,
         download_url=DOWNLOAD, source=None, payload=None):
    requests = []
    response_body = payload if payload is not None else {
        "channel": "stable", "tag": TAG, "version": "0.3.15",
        "asset": {"sha256": "a" * 64, "size": 100},
    }

    class Response(io.BytesIO):
        def geturl(self):
            return final_url

    class Transport:
        def open(self, request, *, timeout):
            requests.append(request.full_url)
            assert timeout == 15
            if request.full_url in (BASE + "/api/downloads/companion/windows", BASE + f"/api/downloads/companion/windows?tag={TAG}"):
                raise urllib.error.HTTPError(request.full_url, download_status, "redirect", {"Location": download_url}, None)
            # Bind origin/path to the active request, not an unrelated URL token.
            assert request.full_url == MANIFEST
            if redirect:
                raise urllib.error.HTTPError(request.full_url, status, "redirect", {"Location": final_url}, None)
            response = Response(json.dumps(response_body).encode())
            response.status = status
            return response

    def opener(handler):
        # Exercise the actual handler: none of these may construct a follow-up.
        for code in (301, 302, 303, 307, 308):
            assert handler().redirect_request(None, None, code, "redirect", {}, final_url) is None
        return Transport()

    def read_evidence(path, *, encoding):
        assert path in ("prepared/TDACompanion-promotion.json", "rc-assets/TDACompanion-candidate.json")
        return io.StringIO(json.dumps({"assets": {"msi": {"sha256": "a" * 64, "size": 100}}}))

    def no_default_transport(*args, **kwargs):
        pytest.fail("default redirect-following transport used")

    monkeypatch.setenv("STABLE_TAG", TAG)
    monkeypatch.setenv("VERSION", "0.3.15")
    monkeypatch.setattr(time, "sleep", lambda _: None)
    monkeypatch.setattr(urllib.request, "build_opener", opener)
    monkeypatch.setattr(urllib.request, "urlopen", no_default_transport)
    exec(compile(source or _smoke_source(), "canonical-release-smoke", "exec"), {"open": read_evidence})
    return requests


def test_direct_canonical_manifest_and_exact_downloads(monkeypatch):
    assert _run(monkeypatch) == [MANIFEST, BASE + "/api/downloads/companion/windows",
                                BASE + f"/api/downloads/companion/windows?tag={TAG}"]


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
@pytest.mark.parametrize("final_url", ["https://other.example/manifest", BASE + "/other-path"])
def test_manifest_redirects_never_verify(monkeypatch, status, final_url):
    with pytest.raises(SystemExit, match="CANONICAL_WEB_STABLE_MANIFEST_MISMATCH"):
        _run(monkeypatch, status=status, final_url=final_url, redirect=True)


@pytest.mark.parametrize("options", [
    {"status": 201}, {"final_url": "https://other.example/manifest"},
    {"payload": []}, {"payload": {"channel": "stable", "version": "wrong"}},
])
def test_noncanonical_or_mismatched_manifest_never_verifies(monkeypatch, options):
    with pytest.raises(SystemExit, match="CANONICAL_WEB_STABLE_MANIFEST_MISMATCH"):
        _run(monkeypatch, **options)


@pytest.mark.parametrize("base", ["http://dnd.faysk.dev", "https://dnd.faysk.dev.evil.example",
    "https://dnd.faysk.dev@evil.example", "https://user@dnd.faysk.dev", "https://dnd.faysk.dev:444",
    "https://dnd.faysk.dev#fragment"])
def test_unused_good_origin_cannot_mask_active_wrong_origin(monkeypatch, base):
    source = _smoke_source().replace(f'base = "{BASE}"', f'unused = "{BASE}"\nbase = "{base}"')
    with pytest.raises(SystemExit, match="CANONICAL_WEB_STABLE_MANIFEST_MISMATCH"):
        _run(monkeypatch, source=source)


@pytest.mark.parametrize("options", [{"download_status": 302}, {"download_url": "https://other.example/file"}])
def test_download_still_requires_exact_307_location(monkeypatch, options):
    with pytest.raises(SystemExit, match="CANONICAL_WEB_STABLE_REDIRECT_MISMATCH"):
        _run(monkeypatch, **options)
