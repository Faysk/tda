"""Regenerate the shared public fixture from the actual store/export implementation."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from tda_companion.store import Store

if __name__ == '__main__':
    with TemporaryDirectory() as directory:
        store = Store(Path(directory))
        store.submit('shared-contract-fixture', dict(kind='synthetic.fixture',
            campaign_id='synthetic-campaign', session_id='synthetic-session',
            source_id='synthetic-source', units=3))
        claim = store.claim()
        while store.step(*claim):
            pass
        fixture = {'health': {'api_version': '1', 'service_version': '0.1.0', 'lifecycle': 'ready'},
                   'job': store.get(claim[0]), 'result': store.result(claim[0])}
    path = Path(__file__).parent / 'fixtures' / 'companion-v1.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
