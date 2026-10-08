from __future__ import annotations
import hashlib
import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path
import pytest

REPO = Path(__file__).resolve().parents[2]
BASE = 'https://dnd.faysk.dev/api/downloads/companion/windows'
TAG = 'companion-v0.3.25'
DATA = b'verified immutable MSI'
SHA = hashlib.sha256(DATA).hexdigest()

def _run(monkeypatch, tmp_path, *, status=200, final_url=None, redirect=False,
         download_status=200, download_url=None, payload=None, base=BASE, download_bytes=DATA):
    spec = importlib.util.spec_from_file_location('canonical_smoke', REPO / 'tools/ci/companion_download_verify.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, 'CANONICAL_DOWNLOAD_URL', base)
    requests = []
    manifest = payload if payload is not None else {'channel':'stable','tag':TAG,'version':'0.3.25','asset':{'sha256':SHA,'size':len(DATA)}}
    class Response(io.BytesIO):
        def __init__(self, data, url, status, headers=None):
            super().__init__(data)
            self.url, self.status, self.headers = url, status, headers or {}
        def geturl(self):
            return self.url
    class Transport:
        def open(self, request, *, timeout):
            requests.append(request.full_url)
            if request.full_url == BASE + '/manifest':
                assert timeout == 30
                if redirect:
                    raise urllib.error.HTTPError(request.full_url,status,'redirect',{'Location':final_url},None)
                return Response(json.dumps(manifest).encode(),final_url or request.full_url,status)
            assert request.full_url in (BASE, BASE + '?tag=' + TAG)
            assert timeout == 60
            return Response(download_bytes,download_url or request.full_url,download_status,
                {'Content-Length':str(len(DATA)),'Content-Disposition':'attachment; filename="TDACompanion-x64.msi"'})
    def opener(handler):
        for code in (301,302,303,307,308):
            assert handler().redirect_request(None,None,code,'redirect',{},final_url) is None
        return Transport()
    candidate = tmp_path / 'candidate.json'
    promotion = tmp_path / 'promotion.json'
    candidate.write_text(json.dumps({'version':'0.3.25','assets':{'msi':{'sha256':SHA,'size':len(DATA)}}}))
    promotion.write_text(json.dumps({'stable_tag':TAG,'assets':{'msi':{'sha256':SHA}}}))
    monkeypatch.setattr(sys,'argv',['verify','--tag',TAG,'--candidate-manifest',str(candidate),'--promotion-manifest',str(promotion)])
    monkeypatch.setattr(module.time,'sleep',lambda _:None)
    monkeypatch.setattr(module.urllib.request,'build_opener',opener)
    monkeypatch.setattr(module.urllib.request,'urlopen',lambda *a,**k:pytest.fail('redirect-following default transport used'))
    module.main()
    return requests

def test_direct_canonical_manifest_and_exact_downloads(monkeypatch,tmp_path):
    assert _run(monkeypatch,tmp_path) == [BASE+'/manifest',BASE,BASE+'?tag='+TAG]

@pytest.mark.parametrize('status',[301,302,303,307,308])
@pytest.mark.parametrize('final_url',['https://other.example/manifest',BASE+'/other-path'])
def test_manifest_redirects_never_verify(monkeypatch,tmp_path,status,final_url):
    with pytest.raises(urllib.error.HTTPError):
        _run(monkeypatch,tmp_path,status=status,final_url=final_url,redirect=True)

@pytest.mark.parametrize('options',[{'status':201},{'final_url':'https://other.example/manifest'},
    {'payload':[]},{'payload':{'channel':'stable','version':'wrong'}},
    {'payload':{'channel':'stable','version':'0.3.25','tag':TAG,'asset':{'size':100,'sha256':SHA}}}])
def test_noncanonical_or_mismatched_manifest_never_verifies(monkeypatch,tmp_path,options):
    with pytest.raises(ValueError,match='CANONICAL_WEB_STABLE_MANIFEST_MISMATCH'):
        _run(monkeypatch,tmp_path,**options)

@pytest.mark.parametrize('base',['http://dnd.faysk.dev/api/downloads/companion/windows',
    'https://dnd.faysk.dev.evil.example/api/downloads/companion/windows',
    'https://dnd.faysk.dev@evil.example/api/downloads/companion/windows',
    'https://user@dnd.faysk.dev/api/downloads/companion/windows',
    'https://dnd.faysk.dev:444/api/downloads/companion/windows',BASE+'#fragment'])
def test_active_wrong_origin_never_verifies(monkeypatch,tmp_path,base):
    with pytest.raises(ValueError,match='CANONICAL_WEB_ORIGIN_INVALID'):
        _run(monkeypatch,tmp_path,base=base)

@pytest.mark.parametrize('options',[{'download_status':302},{'download_url':'https://other.example/file'}])
def test_download_requires_direct_200(monkeypatch,tmp_path,options):
    with pytest.raises(ValueError,match='STABLE_DOWNLOAD_NOT_DIRECT'):
        _run(monkeypatch,tmp_path,**options)

@pytest.mark.parametrize('data',[DATA[:-1],b'x'*len(DATA)])
def test_download_checks_complete_bytes(monkeypatch,tmp_path,data):
    with pytest.raises(ValueError,match='STABLE_DOWNLOAD_BYTES_INVALID'):
        _run(monkeypatch,tmp_path,download_bytes=data)
