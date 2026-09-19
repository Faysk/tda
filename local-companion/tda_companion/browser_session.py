from __future__ import annotations

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass

_SESSION_TTL_SECONDS = 8 * 60 * 60
_MAX_SESSIONS = 32


@dataclass(frozen=True)
class BrowserSession:
    token: str
    expires_in_seconds: int


class BrowserSessionManager:
    """Issue short-lived loopback credentials without exposing the master token.

    Sessions live only in Agent memory and are bound to the exact allowed Origin.
    Restarting the Agent invalidates them, after which the browser can bootstrap a
    fresh session automatically.
    """

    def __init__(
        self,
        *,
        ttl_seconds: int = _SESSION_TTL_SECONDS,
        max_sessions: int = _MAX_SESSIONS,
    ):
        if ttl_seconds < 60 or max_sessions < 1:
            raise ValueError("BROWSER_SESSION_POLICY_INVALID")
        self.ttl_seconds = ttl_seconds
        self.max_sessions = max_sessions
        self._lock = threading.Lock()
        self._sessions: dict[str, tuple[str, float]] = {}

    @staticmethod
    def _digest(token: str) -> str:
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    def _prune(self, now: float) -> None:
        expired = [
            digest
            for digest, (_, expires_at) in self._sessions.items()
            if expires_at <= now
        ]
        for digest in expired:
            self._sessions.pop(digest, None)
        while len(self._sessions) >= self.max_sessions:
            oldest = min(self._sessions, key=lambda key: self._sessions[key][1])
            self._sessions.pop(oldest, None)

    def issue(self, origin: str) -> BrowserSession:
        if not origin or len(origin) > 512:
            raise ValueError("BROWSER_SESSION_ORIGIN_INVALID")
        now = time.monotonic()
        token = secrets.token_urlsafe(32)
        digest = self._digest(token)
        with self._lock:
            self._prune(now)
            self._sessions[digest] = (origin, now + self.ttl_seconds)
        return BrowserSession(token=token, expires_in_seconds=self.ttl_seconds)

    def validate(self, token: str, origin: str | None) -> bool:
        if origin is None or not token or len(token) > 256:
            return False
        try:
            digest = self._digest(token)
        except (UnicodeEncodeError, AttributeError):
            return False
        now = time.monotonic()
        with self._lock:
            row = self._sessions.get(digest)
            if row is None:
                return False
            expected_origin, expires_at = row
            if expires_at <= now:
                self._sessions.pop(digest, None)
                return False
            return secrets.compare_digest(expected_origin, origin)
