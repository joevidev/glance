"""Model calls: async, concurrency-limited, retried on 429/5xx, cached on disk.

Every call is cached by (system, case id, sha256 of prompt+settings) under
results/cache/<system>/ so a rerun is free. Failures are NOT cached (a rerun retries
them) and are scored as wrong answers by the runner.

Prices are per 1M tokens, looked up 2026-11-02, see results/PRICING.md. Reasoning
tokens are billed as output tokens and are included in completion_tokens; the
prompt-cache discount is NOT applied (we bill every input token at the full rate, which
can only overstate cost).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import random
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..common import RESULTS

CACHE = RESULTS / "cache"
FIREWORKS_URL = "https://api.fireworks.ai/inference/v1"
OPEN_MODEL = "accounts/fireworks/models/glm-5p3-flash"
FRONTIER_MODEL = "gpt-6-astra"
BACKOFF_SCALE = 1.0   # tests set this to 0


@dataclass(frozen=True)
class ModelSpec:
    key: str                      # short label used in cache keys
    provider: str                 # "fireworks" | "openai"
    model: str
    price_in: float | None        # USD per 1M input tokens, None = unknown
    price_out: float | None       # USD per 1M output tokens
    send_temperature: bool = True  # frontier reasoning model rejects temperature
    token_param: str = "max_tokens"
    max_tokens: int = 8192


# USD per 1M tokens (input, output), looked up 2026-11-02 on each model's Fireworks page.
# A model that is not in this table gets None (cost_usd null), never a guess.
OPEN_PRICES: dict[str, tuple[float, float]] = {
    "accounts/fireworks/models/glm-5p3-flash": (0.15, 0.50),
    "accounts/fireworks/models/glm-5p3": (1.40, 4.40),   # fireworks.ai/models/fireworks/glm-5p3, 2026-11-02
}


def open_spec(model: str = OPEN_MODEL) -> ModelSpec:
    # glm-5p3-flash is thinking-only (reasoning_effort="none" is rejected), so the
    # token budget must cover the reasoning trace; 4096 truncated 1 of 8 smoke cases (empty content), so 8192.
    pi, po = OPEN_PRICES.get(model, (None, None))
    return ModelSpec("open", "fireworks", model, pi, po)


def frontier_spec(model: str = FRONTIER_MODEL) -> ModelSpec:
    # gpt-6* / gpt-5.x reject temperature != 1 and `max_tokens`: omit temperature,
    # use max_completion_tokens.
    prices = {"gpt-6-astra": (10.0, 50.0), "gpt-6.1-sol": (2.0, 10.0), "gpt-5.5": (5.0, 30.0), "gpt-5.4": (2.5, 15.0),
              "gpt-5.4-mini": (0.75, 4.5)}   # all from developers.openai.com/api/docs/pricing, 2026-11-02 (see results/PRICING.md)
    pi, po = prices.get(model, (None, None))
    return ModelSpec("frontier", "openai", model, pi, po, send_temperature=False,
                     token_param="max_completion_tokens", max_tokens=4096)


@dataclass
class Completion:
    text: str | None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    latency_ms: float | None = None
    cost_usd: float | None = None
    error: str | None = None
    cached: bool = False
    finish_reason: str | None = None
    retries: int = 0            # in-call retries (429 / 5xx / connection) before this result
    transient: bool = False     # error was a transient infrastructure error (never scored as a wrong answer)


def cost_usd(spec: ModelSpec, pt: int | None, ct: int | None) -> float | None:
    if None in (spec.price_in, spec.price_out, pt, ct):
        return None
    return (pt * spec.price_in + ct * spec.price_out) / 1e6


def make_client(spec: ModelSpec):
    from openai import AsyncOpenAI

    from ..common import require_env

    if spec.provider == "fireworks":
        return AsyncOpenAI(api_key=require_env("FIREWORKS_API_KEY"), base_url=FIREWORKS_URL, max_retries=0, timeout=180)
    return AsyncOpenAI(api_key=require_env("OPENAI_API_KEY"), max_retries=0, timeout=180)


def cache_key(spec: ModelSpec, prompt: str, temperature: float, sample: int) -> str:
    h = hashlib.sha256(json.dumps([spec.model, spec.max_tokens, temperature, sample, prompt]).encode()).hexdigest()
    return h[:24]


def _path(system: str, case_id: str, key: str, cache_dir: Path) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in case_id)
    return cache_dir / system / f"{safe}__{key}.json"


def _is_retryable(e: Exception) -> bool:
    status = getattr(e, "status_code", None)
    if status in (402, 412):   # account suspended / billing block: infrastructure, never a wrong answer; rows stay incomplete
        return True
    if status in (408, 409, 429) or (isinstance(status, int) and status >= 500):
        return True
    return type(e).__name__ in ("APIConnectionError", "APITimeoutError", "RateLimitError", "InternalServerError")


async def call_model(client, spec: ModelSpec, prompt: str, temperature: float, *, retries: int = 14) -> Completion:
    kw = {spec.token_param: spec.max_tokens}
    if spec.send_temperature:
        kw["temperature"] = temperature
    last = None
    transient = False
    for attempt in range(retries + 1):
        t0 = time.perf_counter()
        try:
            r = await client.chat.completions.create(model=spec.model, messages=[{"role": "user", "content": prompt}], **kw)
            ms = (time.perf_counter() - t0) * 1000
            u = getattr(r, "usage", None)
            pt = getattr(u, "prompt_tokens", None)
            ct = getattr(u, "completion_tokens", None)
            text = r.choices[0].message.content or ""
            return Completion(text, pt, ct, ms, cost_usd(spec, pt, ct), None, False, getattr(r.choices[0], "finish_reason", None), attempt)
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {str(e)[:200]}"
            transient = _is_retryable(e)
            if attempt < retries and transient:
                await asyncio.sleep(min(60, 2 ** attempt) * BACKOFF_SCALE * (0.5 + random.random()))
                continue
            break
    return Completion(None, error=last, retries=attempt, transient=transient)


async def cached_call(client, spec: ModelSpec, system: str, case_id: str, prompt: str, temperature: float,
                      sem: asyncio.Semaphore, *, sample: int = 0, cache_dir: Path = CACHE) -> Completion:
    p = _path(system, case_id, cache_key(spec, prompt, temperature, sample), cache_dir)
    if p.exists():
        d = json.loads(p.read_text())
        return Completion(d["text"], d.get("prompt_tokens"), d.get("completion_tokens"), d.get("latency_ms"),
                          d.get("cost_usd"), None, True, d.get("finish_reason"), d.get("retries", 0))
    async with sem:
        c = await call_model(client, spec, prompt, temperature)
    if c.error is None:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"text": c.text, "prompt_tokens": c.prompt_tokens, "completion_tokens": c.completion_tokens,
                                 "latency_ms": c.latency_ms, "cost_usd": c.cost_usd, "finish_reason": c.finish_reason, "retries": c.retries, "model": spec.model,
                                 "system": system, "case_id": case_id, "sample": sample, "temperature": temperature}))
    return c
