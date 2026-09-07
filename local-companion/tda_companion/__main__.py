"""Explicit per-user launch; never discovers, kills or modifies legacy processes."""
import argparse
import os
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn

from .api import create_app


class RootLock:
    def __init__(self, root):
        self.path = root / 'supervisor.lock'

    def __enter__(self):
        self.handle = self.path.open('a+b')
        self.handle.seek(0)
        self.handle.write(b'0')
        self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.handle.close()
            raise RuntimeError('DATA_ROOT_IN_USE') from None
        return self

    def __exit__(self, *_):
        self.handle.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--origin', action='append', required=True)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('INVALID_PORT')
    for origin in args.origin:
        parsed = urlsplit(origin)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or '*' in origin or (parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', 'localhost')):
            parser.error('EXACT_HTTPS_OR_LOOPBACK_ORIGIN_REQUIRED')
    # New roots only by explicit operator argument; never guesses old data locations.
    args.data_root.mkdir(parents=True, exist_ok=True)
    token = args.token_file.read_text(encoding='utf-8').strip()
    with RootLock(args.data_root):
        app = create_app(args.data_root, token, frozenset(args.origin), args.port)
        uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False,
                    proxy_headers=False, server_header=False, log_level='critical')


if __name__ == '__main__':
    main()
