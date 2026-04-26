import time
import threading
from collections import defaultdict
from fastapi import HTTPException, Request

_store: dict[str, list[float]] = defaultdict(list)
_lock = threading.Lock()


def rate_limit(request: Request, max_req: int, window: int = 60):
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _lock:
        ts = _store[ip]
        _store[ip] = [t for t in ts if now - t < window]
        if len(_store[ip]) >= max_req:
            raise HTTPException(status_code=429, detail="Too many requests, please slow down")
        _store[ip].append(now)
