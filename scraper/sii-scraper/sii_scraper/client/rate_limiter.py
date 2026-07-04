import asyncio
import time


class RateLimiter:
    def __init__(self, rate_per_second: float):
        self._rate = float(rate_per_second)
        self._capacity = float(rate_per_second)
        self._tokens = float(rate_per_second)
        self._updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                self._tokens = min(
                    self._capacity,
                    self._tokens + (now - self._updated) * self._rate,
                )
                self._updated = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                await asyncio.sleep((1 - self._tokens) / self._rate)
