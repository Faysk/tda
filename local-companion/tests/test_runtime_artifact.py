import hashlib
import json
import zipfile

import pytest

from tda_companion.runtime_artifact import RuntimeArtifactError, artifact_from_environment, runtime_artifact, verify_frozen_runtime_artifact
from tda_companion.execution_lineage import capture_execution_lineage
from test_execution_lineage import _document


@pytest.mark.parametrize('family,runtime_id', [('whisper','whisper-ctranslate2'),('qwen','qwen3-transformers')])
def test_capture_preserves_dispatch_identity_without_reading_runtime(family, runtime_id, monkeypatch):
    identity = {'runtime_id': runtime_id, 'version':'1.2.3', 'worker_sha256':'a'*64, 'archive_sha256':'b'*64}
    env = {'TDA_ASR_RUNTIME_FAMILY':family,'TDA_ASR_RUNTIME_VERSION':'1.2.3','TDA_ASR_RUNTIME_ARTIFACT':json.dumps({**identity, 'path':'private'})}
    value = capture_execution_lineage(_document('cpu'), snapshot={}, environ=env)
    env['TDA_ASR_RUNTIME_ARTIFACT'] = json.dumps({**identity, 'worker_sha256':'c'*64})
    assert value['runtime_artifact'] == identity
    assert 'private' not in json.dumps(value)
    assert artifact_from_environment({}) is None


@pytest.mark.parametrize('patch', [{'worker_sha256':'not-hex'}, {'archive_sha256':'/private/path'}, {'version':'9.9.9'}, {'runtime_id':'wrong'}])
def test_malformed_or_mismatched_identity_is_not_persisted(patch):
    identity = {'runtime_id':'qwen3-transformers','version':'1.2.3','worker_sha256':'a'*64,'archive_sha256':None,**patch}
    assert runtime_artifact(identity, family='qwen', version='1.2.3') is None


def test_whisper_dispatch_passes_identity_from_same_inspected_marker(tmp_path, monkeypatch):
    from tda_companion import asr_runtime
    from tda_companion.worker_supervisor import WorkerSupervisor, WorkerOutcome
    from tda_companion.runtime_compat import MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
    archive = tmp_path / 'worker.zip'
    with zipfile.ZipFile(archive, 'w') as out:
        out.writestr('TDAWhisperWorker.exe', b'synthetic worker')
    archive_sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    runtime_root = tmp_path / 'Runtime'
    marker = asr_runtime.install_whisper_runtime_archive(archive, runtime_root, version=MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION, expected_sha256=archive_sha)
    monkeypatch.setattr(asr_runtime, '_sha256_file', lambda *_: (_ for _ in ()).throw(AssertionError('dispatch must not rehash sealed worker')))
    supervisor = WorkerSupervisor(data_root=tmp_path/'Data', models_root=tmp_path/'Models', runtime_root=runtime_root)
    observed = {}
    def launch(command, **kwargs):
        observed.update(kwargs)
        return WorkerOutcome(terminal='result', payload={}, returncode=0)
    monkeypatch.setattr(supervisor, '_run_command', launch)
    supervisor.run_craig(job_id='job',attempt=1,source_id='source',profile_id='whisper-turbo',glossary='',context='',cpu=True,on_progress=lambda _:None)
    env = observed['environment_overrides']
    identity = json.loads(env['TDA_ASR_RUNTIME_ARTIFACT'])
    assert identity == {k:marker[k] for k in ('runtime_id','version','worker_sha256','archive_sha256')}
    assert env['TDA_ASR_RUNTIME_VERSION'] == identity['version']
    assert capture_execution_lineage(_document('cpu'), snapshot={}, environ=env)['runtime_artifact'] == identity


def test_frozen_child_requires_exact_adjacent_runtime_marker(tmp_path):
    identity = {
        "runtime_id": "qwen3-transformers",
        "version": "1.2.3",
        "worker_sha256": "a" * 64,
        "archive_sha256": "b" * 64,
    }
    environment = {
        "TDA_ASR_RUNTIME_FAMILY": "qwen",
        "TDA_ASR_RUNTIME_VERSION": "1.2.3",
        "TDA_ASR_RUNTIME_ARTIFACT": json.dumps(identity),
    }
    executable = tmp_path / "TDAQwenWorker.exe"
    executable.write_bytes(b"synthetic")
    marker = {"schema": "tda_asr_runtime_v1", **identity}
    (tmp_path / ".tda-runtime.json").write_text(json.dumps(marker), encoding="utf-8")

    assert verify_frozen_runtime_artifact(
        environment,
        executable=executable,
        frozen=True,
    ) == identity

    (tmp_path / ".tda-runtime.json").write_text(
        json.dumps({**marker, "worker_sha256": "c" * 64}),
        encoding="utf-8",
    )
    with pytest.raises(RuntimeArtifactError, match="ASR_RUNTIME_IDENTITY_INVALID"):
        verify_frozen_runtime_artifact(environment, executable=executable, frozen=True)


def test_frozen_child_fails_closed_when_parent_identity_is_missing(tmp_path):
    executable = tmp_path / "TDAWhisperWorker.exe"
    executable.write_bytes(b"synthetic")
    with pytest.raises(RuntimeArtifactError, match="ASR_RUNTIME_IDENTITY_INVALID"):
        verify_frozen_runtime_artifact({}, executable=executable, frozen=True)
