import asyncio
import time
import pytest
from sii_scraper.client.rate_limiter import RateLimiter


async def test_first_burst_is_immediate():
    rl = RateLimiter(rate_per_second=10)  # bucket lleno = 10
    start = time.monotonic()
    for _ in range(10):
        await rl.acquire()
    assert time.monotonic() - start < 0.2  # los 10 primeros no esperan


async def test_throttles_after_bucket_empty():
    rl = RateLimiter(rate_per_second=10)
    for _ in range(10):        # vacía el bucket
        await rl.acquire()
    start = time.monotonic()
    for _ in range(5):         # 5 más → ~0.5s a 10/s
        await rl.acquire()
    elapsed = time.monotonic() - start
    assert elapsed >= 0.4


async def test_concurrent_acquires_respect_rate():
    rl = RateLimiter(rate_per_second=10)
    for _ in range(10):  # drain the initial burst
        await rl.acquire()
    start = time.monotonic()
    await asyncio.gather(*(rl.acquire() for _ in range(10)))  # 10 concurrent waiters
    elapsed = time.monotonic() - start
    assert elapsed >= 0.8  # ~10 tokens at 10/s, with slack
