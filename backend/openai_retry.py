"""Retry OpenAI calls on 429 / transient errors with backoff (reduces hard failures at TPM limits)."""

from __future__ import annotations

import asyncio
import logging
import os
import random
import re
import time
from typing import Awaitable, Callable, TypeVar

logger = logging.getLogger("vision2voice.openai_retry")

T = TypeVar("T")


def _retry_max_attempts() -> int:
    return max(1, int(os.getenv("OPENAI_RETRY_MAX_ATTEMPTS", "6")))


def _retry_base_sec() -> float:
    return max(0.05, float(os.getenv("OPENAI_RETRY_BASE_SEC", "0.5")))


def _retry_max_wait_sec() -> float:
    return max(0.1, float(os.getenv("OPENAI_RETRY_MAX_WAIT_SEC", "60")))


def _parse_try_again_ms(message: str) -> float | None:
    m = re.search(r"try again in\s+(\d+(?:\.\d+)?)\s*ms", message, re.IGNORECASE)
    if m:
        return max(0.05, float(m.group(1)) / 1000.0)
    return None


def _is_retryable(exc: BaseException) -> bool:
    try:
        from openai import APIConnectionError, APIStatusError, RateLimitError
    except ImportError:
        return False
    if isinstance(exc, RateLimitError):
        return True
    if isinstance(exc, APIConnectionError):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code in (429, 502, 503, 504)
    return False


def _sleep_seconds(exc: BaseException, attempt: int) -> float:
    cap = _retry_max_wait_sec()
    msg = str(exc)
    hint = _parse_try_again_ms(msg)
    if hint is not None:
        return min(cap, hint + random.uniform(0.05, 0.25))
    base = _retry_base_sec()
    exp = base * (2 ** (attempt - 1)) + random.uniform(0, base * 0.5)
    return min(cap, exp)


async def with_openai_retry(call: Callable[[], Awaitable[T]], *, label: str = "openai") -> T:
    max_attempts = _retry_max_attempts()
    for attempt in range(1, max_attempts + 1):
        try:
            return await call()
        except BaseException as e:
            if not _is_retryable(e) or attempt >= max_attempts:
                raise
            wait = _sleep_seconds(e, attempt)
            logger.warning(
                "%s: retryable OpenAI error (%s/%s), sleeping %.2fs: %s",
                label,
                attempt,
                max_attempts,
                wait,
                e,
            )
            await asyncio.sleep(wait)
    raise RuntimeError("with_openai_retry: unreachable")


def with_openai_retry_sync(call: Callable[[], T], *, label: str = "openai") -> T:
    max_attempts = _retry_max_attempts()
    for attempt in range(1, max_attempts + 1):
        try:
            return call()
        except BaseException as e:
            if not _is_retryable(e) or attempt >= max_attempts:
                raise
            wait = _sleep_seconds(e, attempt)
            logger.warning(
                "%s: retryable OpenAI error (%s/%s), sleeping %.2fs: %s",
                label,
                attempt,
                max_attempts,
                wait,
                e,
            )
            time.sleep(wait)
    raise RuntimeError("with_openai_retry_sync: unreachable")
