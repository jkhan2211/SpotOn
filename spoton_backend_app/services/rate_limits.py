"""Server-side abuse limits for the public API's agent routes.

Every /api/chat and /api/admin/chat call invokes AgentCore and Claude, so those are
the requests that cost real money. The limits live here, on the server, because
anything enforced in the browser can be skipped with curl.

State is in memory, per ECS task. It is exact while the service runs one task; with
N tasks every limit is effectively N times higher. It is a guard for a public demo,
not a distributed rate limiter.
"""
import logging
import os
import threading
import time
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timezone

from starlette.requests import Request

logger = logging.getLogger("spoton.limits")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# One full walkthrough of all three demo flows is roughly 15-20 agent messages, so the
# defaults leave a judge plenty of room. Each value can be changed through the ECS
# environment without rebuilding the image.
MAX_CONCURRENT = _env_int("SPOTON_AGENT_MAX_CONCURRENT", 4)
PER_IP_PER_10_MIN = _env_int("SPOTON_AGENT_PER_IP_PER_10_MIN", 30)
PER_IP_PER_DAY = _env_int("SPOTON_AGENT_PER_IP_PER_DAY", 150)
PER_SESSION = _env_int("SPOTON_AGENT_PER_SESSION", 40)
NEW_SESSIONS_PER_IP_PER_HOUR = _env_int("SPOTON_NEW_SESSIONS_PER_IP_PER_HOUR", 20)
GLOBAL_PER_DAY = _env_int("SPOTON_AGENT_GLOBAL_PER_DAY", 500)

_TEN_MIN, _HOUR, _DAY = 600, 3600, 86400
_MAX_TRACKED_KEYS = 10_000  # bounds memory when a caller rotates IPs or session ids


class LimitExceeded(Exception):
    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


_lock = threading.Lock()
_slots = threading.BoundedSemaphore(MAX_CONCURRENT)
_ip_calls: dict[str, deque] = {}         # ip -> agent call timestamps (last 24 h)
_ip_new_sessions: dict[str, deque] = {}  # ip -> first-seen-session timestamps (last hour)
_sessions: dict[str, list] = {}          # session_id -> [agent calls, last seen]
_global = {"day": "", "count": 0}


def client_ip(request: Request) -> str:
    """The caller's IP as the load balancer saw it.

    The ALB's X-Forwarded-For processing mode is "append": it adds the address that
    actually connected as the LAST entry. Anything before it came from the client and
    can be forged, so only the last entry is trusted.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _trim(timestamps: deque, window: int, now: float) -> None:
    while timestamps and now - timestamps[0] > window:
        timestamps.popleft()


def _prune(now: float) -> None:
    for store in (_ip_calls, _ip_new_sessions):
        for key in [k for k, q in store.items() if not q or now - q[-1] > _DAY]:
            del store[key]
    for key in [k for k, (_, seen) in _sessions.items() if now - seen > _DAY]:
        del _sessions[key]


def _reject(message: str, retry_after: int, reason: str, key: str) -> None:
    logger.warning("agent limit reached reason=%s key=%s", reason, key)
    raise LimitExceeded(message, retry_after)


def check_agent_quota(request: Request, session_id: str) -> None:
    """Count one agent call against every limit, or raise LimitExceeded.

    The call is counted before AgentCore is invoked, so calls that later fail still use
    quota: the model and runtime cost is incurred either way.
    """
    ip = client_ip(request)
    now = time.time()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    with _lock:
        if len(_ip_calls) > _MAX_TRACKED_KEYS or len(_sessions) > _MAX_TRACKED_KEYS:
            _prune(now)
            if len(_ip_calls) > _MAX_TRACKED_KEYS or len(_sessions) > _MAX_TRACKED_KEYS:
                _reject("SpotOn is busy right now. Please try again later.", 600, "tracking_full", ip)

        if _global["day"] != today:
            _global["day"], _global["count"] = today, 0
        if _global["count"] >= GLOBAL_PER_DAY:
            _reject("SpotOn's live demo has reached today's usage limit. Please try again tomorrow.",
                    3600, "global_daily", "all")

        calls = _ip_calls.setdefault(ip, deque())
        _trim(calls, _DAY, now)
        if len(calls) >= PER_IP_PER_DAY:
            _reject("You've reached today's message limit for the SpotOn demo. Please try again tomorrow.",
                    3600, "ip_daily", ip)
        if sum(1 for t in calls if now - t <= _TEN_MIN) >= PER_IP_PER_10_MIN:
            _reject("You're sending messages quickly. Please wait a few minutes and try again.",
                    120, "ip_10min", ip)

        if session_id not in _sessions:
            new_sessions = _ip_new_sessions.setdefault(ip, deque())
            _trim(new_sessions, _HOUR, now)
            if len(new_sessions) >= NEW_SESSIONS_PER_IP_PER_HOUR:
                _reject("Too many new conversations from your network. Please try again later.",
                        600, "ip_new_sessions", ip)
            new_sessions.append(now)
            _sessions[session_id] = [0, now]
        session = _sessions[session_id]
        if session[0] >= PER_SESSION:
            _reject("This conversation has reached its message limit. Open SpotOn in a new tab to start another.",
                    60, "session", session_id)

        calls.append(now)
        session[0] += 1
        session[1] = now
        _global["count"] += 1


@contextmanager
def agent_slot():
    """Allow at most MAX_CONCURRENT agent calls at once in this task.

    Extra calls are turned away immediately instead of queued: a queue only delays the
    same cost, and busy rejections don't use up the caller's quota.
    """
    if not _slots.acquire(blocking=False):
        _reject("SpotOn is busy right now. Please try again in a moment.", 5, "concurrency", "all")
    try:
        yield
    finally:
        _slots.release()
