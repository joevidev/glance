"""Shared pieces of the LoRA pipeline: tokenization, datums, status file, sampling.

NOTE ON LATENCY: sampling here goes through the Fireworks *training* sampler
(serverless training sessions, shared GPUs, LoRA hot-loaded per session). The
latency measured is NOT serving latency and must not be compared with
production endpoints. It is recorded per row for audit only.

Prompt layout: the shipped GLM-5.3-Flash chat template (verified token for token
against tokenizer.apply_chat_template), default thinking mode, single turn:

    [gMASK]<sop><|system|>Reasoning Effort: Max<|user|>{prompt}<|assistant|><think>
        </think>{completion}<|user|>

The first line is the *context* (weight 0; it is exactly the generation prompt).
``</think>`` + completion + the closing ``<|user|>`` role sentinel (the stop
token) carry loss weight 1, so the model learns to close an empty think block
and answer with the JSON immediately. At inference only the context is sent and
generation stops on ``<|user|>``.
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from ..common import RESULTS, TRAIN_LOG
from ..prompt import build_prompt, completion

BASE_MODEL = "accounts/fireworks/models/glm-5p3"   # was glm-5p3-flash: 409 capacity_exhausted at real-run start (12:42 PT)
TOKENIZER_MODEL = "zai-org/GLM-5.3-Flash"
SERVERLESS_URL = "https://api.fireworks.ai/training/v1/serverless"

BOS_TEXT = "[gMASK]<sop>"
SYSTEM_TEXT = "<|system|>Reasoning Effort: Max"   # injected by the shipped GLM-5.3 template
USER_TAG = "<|user|>"
ASSISTANT_GEN = "<|assistant|><think>"             # generation suffix (thinking mode)
THINK_CLOSE = "</think>"

# Serverless pricing, USD per 1M tokens, GLM 5.3 (full; the base actually used) from docs serverless.md, 2026-11-02.
# (GLM 5.3 Flash would be prefill 2.96 / sample 7.41 / train 8.89.)
PRICE_PREFILL = 4.86
PRICE_SAMPLE = 12.15
PRICE_TRAIN = 14.58


# ------------------------------------------------------------------ model formats

MUSE_BASE_MODEL = "accounts/fireworks/models/muse-glimmer-30b"
MUSE_TOKENIZER = "meta-models/Muse-Glimmer-30B"
MUSE_DATE = "2026-11-02"   # fixed (the shipped template injects today's date); same string at train and inference


@dataclass(frozen=True)
class Fmt:
    name: str
    tokenizer: str
    stop_tag: str                  # single-token end-of-turn marker, used as sampler stop and last weighted token
    target_prefix: str             # weighted text that precedes the JSON completion
    price_prefill: float           # USD per 1M tokens (serverless.md table)
    price_sample: float
    price_train: float
    default_rank: int
    rows_system: str               # system name for plain-variant rows
    rows_file: str

    def ctx(self, prompt: str) -> str:
        if self.name == "glm":
            return f"{BOS_TEXT}{SYSTEM_TEXT}{USER_TAG}{prompt}{ASSISTANT_GEN}"
        if self.name == "muse":
            # Matches meta-models/Muse-Glimmer-30B chat_template (apply_chat_template, add_generation_prompt=True)
            return (
                "<|begin_of_text|><|start|>system<|message|>You are a helpful AI assistant.\n"
                f"Knowledge cutoff: 2026-01-04.\nCurrent date: {MUSE_DATE}.\n\nReasoning strength: high.\n\n"
                '# Valid recipients: "self", "user".<|eot|>'
                f"<|start|>user<|message|>{prompt}<|eot|><|start|>assistant"
            )
        raise ValueError(self.name)


FORMATS = {
    "glm": Fmt("glm", TOKENIZER_MODEL, USER_TAG, THINK_CLOSE, 4.86, 12.15, 14.58, 16, "lora", "lora.jsonl"),
    # Muse prices from the serverless.md table (prefill 1.96 / sample 4.88 / train 5.86); training itself is free until 2026-11-30 per the muse-glimmer docs page.
    "muse": Fmt("muse", MUSE_TOKENIZER, "<|eot|>", " to=user<|message|>", 1.96, 4.88, 5.86, 8, "lora_muse", "lora_muse.jsonl"),
}
ACTIVE: Fmt = FORMATS["glm"]


def format_name_for(base_model: str) -> str:
    return "muse" if "muse-glimmer" in base_model else "glm"


def use_format(name: str) -> Fmt:
    """Select the token format for the rest of the process (call once, before building any example)."""
    global ACTIVE
    ACTIVE = FORMATS[name]
    return ACTIVE


# ------------------------------------------------------------------ tokenization

def context_text(case: dict, *, with_gaze: bool = True, variant: str = "plain") -> str:
    return ACTIVE.ctx(build_prompt(case, with_gaze=with_gaze, variant=variant))


def encode(tokenizer: Any, text: str) -> list[int]:
    """Encode text without adding extra special tokens; special tags in the text map to their ids."""
    return [int(t) for t in tokenizer.encode(text, add_special_tokens=False)]


def special_id(tokenizer: Any, tag: str) -> int:
    ids = encode(tokenizer, tag)
    if len(ids) != 1:
        raise ValueError(f"{tag!r} is not a single token for this tokenizer: {ids}")
    return ids[0]


def prompt_tokens(tokenizer: Any, case: dict, variant: str = "plain") -> list[int]:
    """Tokens sent to the sampler (context only)."""
    return encode(tokenizer, context_text(case, variant=variant))


def build_example(tokenizer: Any, case: dict, max_seq_len: int = 8192, variant: str = "plain") -> tuple[list[int], list[float]] | None:
    """Full token sequence and per-token loss weights (0 on context, 1 on completion + stop).

    Returns None if the example would be truncated (we drop rather than truncate:
    a truncated example would train on a cut-off prompt).
    """
    ctx = prompt_tokens(tokenizer, case, variant)
    tgt = encode(tokenizer, ACTIVE.target_prefix + completion(case["answer"])) + [special_id(tokenizer, ACTIVE.stop_tag)]
    tokens = ctx + tgt
    if len(tokens) > max_seq_len:
        return None
    weights = [0.0] * len(ctx) + [1.0] * len(tgt)
    return tokens, weights


def shift(tokens: Sequence[int], weights: Sequence[float]) -> tuple[list[int], list[int], list[float]]:
    """Next-token layout: model sees tokens[:-1], targets are tokens[1:], weights[1:]."""
    if len(tokens) != len(weights):
        raise ValueError("tokens and weights must have equal length")
    return list(tokens[:-1]), list(tokens[1:]), [float(w) for w in weights[1:]]


def build_datum(tokenizer: Any, case: dict, max_seq_len: int = 8192, variant: str = "plain"):
    """Fireworks cross_entropy Datum for one case, or None if too long."""
    from fireworks.training.sdk import Datum, ModelInput

    ex = build_example(tokenizer, case, max_seq_len, variant)
    if ex is None:
        return None
    inp, tgt, w = shift(*ex)
    return Datum(
        model_input=ModelInput.from_ints(inp),
        loss_fn_inputs={"target_tokens": tgt, "weights": w},
    )


def lr_at(lr: float, schedule: str, step: int, total_steps: int) -> float:
    """Learning rate for 0-based `step`. linear: lr at step 0 decaying to lr/total_steps at the last step."""
    if schedule == "constant":
        return lr
    if schedule == "linear":
        return lr * (total_steps - step) / total_steps
    raise ValueError(schedule)


def load_tokenizer(name: str | None = None):
    name = name or ACTIVE.tokenizer
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained(name)


# ------------------------------------------------------------------ status / jobs log

class Status:
    """results/train/status.json, rewritten atomically; a heartbeat thread refreshes it every ~15 s."""

    def __init__(self, base_model: str = BASE_MODEL, path: Path | None = None, interval: float = 15.0):
        self.path = path or (TRAIN_LOG / "status.json")
        self.interval = interval
        self.t0 = time.time()
        self._lock = threading.Lock()
        self.data: dict[str, Any] = {
            "state": "init", "step": 0, "total_steps": 0, "elapsed_s": 0.0, "last_update": None,
            "session": None, "run_id": None, "base_model": base_model, "errors": [],
        }
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def update(self, **kw: Any) -> None:
        with self._lock:
            self.data.update(kw)
            self._write()

    def error(self, msg: str) -> None:
        with self._lock:
            self.data["errors"] = (self.data["errors"] + [msg[:500]])[-20:]
            self._write()

    def _write(self) -> None:
        self.data["elapsed_s"] = round(time.time() - self.t0, 1)
        self.data["last_update"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2))
        tmp.replace(self.path)

    def start(self) -> "Status":
        def beat() -> None:
            while not self._stop.wait(self.interval):
                with self._lock:
                    self._write()

        self.update()
        self._thread = threading.Thread(target=beat, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()


def log_job(kind: str, value: str, path: Path | None = None) -> None:
    """Append a job/session/run/checkpoint id to results/train/jobs.log."""
    p = path or (TRAIN_LOG / "jobs.log")
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {kind} {value}\n")


# ------------------------------------------------------------------ service / sampling

def make_service(api_key: str):
    from fireworks.training.sdk import FiretitanServiceClient

    return FiretitanServiceClient(api_key=api_key, base_url=SERVERLESS_URL)


def create_training_client(service: Any, rank: int, status: "Status | None" = None,
                           max_wait_s: float = 1500.0, base_model: str | None = None):
    """create_lora_training_client, retrying HTTP 409 'capacity_exhausted' (shared pool full).

    Backoff 5, 10, 20, 30, 30... s for up to max_wait_s. Every attempt is written to
    status.json (state "waiting_capacity", attempts list with timestamps).
    Seen on 2026-11-02 12:30 PT for glm-5p3-flash: "out of capacity: training capacity
    for new models is temporarily unavailable. Please retry shortly."
    """
    try:
        service._enable_serverless_supervised_409_retry()
    except Exception:  # noqa: BLE001  (private SDK hook; fine if it is gone)
        pass
    t0, n, attempts = time.time(), 0, []
    delays = [5, 10, 20, 30]
    while True:
        try:
            return service.create_lora_training_client(base_model=base_model or BASE_MODEL, rank=rank)
        except Exception as e:  # noqa: BLE001
            msg = f"{type(e).__name__}: {e}"
            capacity = is_transient(e)
            attempts.append({"t": time.strftime("%H:%M:%S"), "err": msg[:160]})
            if status is not None:
                status.update(state="waiting_capacity" if capacity else "client_error",
                              capacity_retries=n + 1, capacity_attempts=attempts[-10:])
            if not capacity or time.time() - t0 > max_wait_s:
                raise
            time.sleep(delays[min(n, len(delays) - 1)])
            n += 1


TRANSIENT_MARKERS = ("connection", "timeout", "timed out", "409", "429", "capacity", "500", "502", "503", "504",
                     "unavailable", "temporar", "reset", "remote", "ssl", "enotfound", "name resolution", "closed")


def is_transient(e: BaseException) -> bool:
    m = f"{type(e).__name__}: {e}".lower()
    return any(k in m for k in TRANSIENT_MARKERS)


def retry_call(fn: Callable[[], Any], what: str, status: "Status | None" = None,
               max_total_s: float = 1500.0, max_delay_s: float = 60.0) -> Any:
    """Run fn() (which must submit AND .result() the SDK call). Retry transient errors
    (APIConnectionError, timeouts, 409/429, 5xx) with exponential backoff 5,10,20,40,60...
    Each retry is logged in status.json (errors + retries counter). Non-transient errors raise.
    NOTE: retrying forward_backward/optim_step after an ambiguous failure can in rare cases
    apply an update twice; this is accepted for robustness and noted in NOTES.md.
    """
    t0, n, delay = time.time(), 0, 5.0
    while True:
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if not is_transient(e) or time.time() - t0 > max_total_s:
                raise
            n += 1
            if status is not None:
                with status._lock:
                    status.data["retries"] = status.data.get("retries", 0) + 1
                    status.data["last_retry"] = f"{time.strftime('%H:%M:%S')} {what}: {type(e).__name__}"
                status.error(f"retry {n} {what}: {type(e).__name__}: {str(e)[:120]}")
            time.sleep(delay)
            delay = min(delay * 2, max_delay_s)


def sample_one(sampler: Any, tokenizer: Any, tokens: list[int], stop_id: int, max_tokens: int = 24) -> tuple[str, int, float]:
    """Greedy sample. Returns (text, n_output_tokens, wall_seconds)."""
    from fireworks.training.sdk import ModelInput, SamplingParams

    params = SamplingParams(max_tokens=max_tokens, temperature=0.0, stop=[stop_id])
    t = time.perf_counter()
    res = sampler.sample(prompt=ModelInput.from_ints(tokens), num_samples=1, sampling_params=params).result()
    dt = time.perf_counter() - t
    out = [int(x) for x in res.sequences[0].tokens]
    text = tokenizer.decode([x for x in out if x != stop_id], skip_special_tokens=False)
    return text, len(out), dt   # text is normally '</think>{"target": N}'


def estimate_cost(prompt_tok: int, out_tok: int) -> float:
    """ESTIMATE from the serverless price table (no cached-prefill discount assumed)."""
    return prompt_tok / 1e6 * ACTIVE.price_prefill + out_tok / 1e6 * ACTIVE.price_sample


def make_row(case: dict, text: str | None, n_prompt: int, n_out: int, latency_s: float | None, system: str = "lora") -> dict:
    from ..prompt import parse_decision

    pred = parse_decision(text) if text is not None else None
    return {
        "id": case["id"], "site": case["site"], "system": system, "sigma": case["sigma"],
        "answer": case["answer"], "pred": pred, "score": int(pred is not None and pred == case["answer"]),
        "latency_ms": None if latency_s is None else round(latency_s * 1000, 1),
        "cost_usd": round(estimate_cost(n_prompt, n_out), 8) if text is not None else None,
        "raw": text,
    }


def synthetic_cases(n: int = 16, seed: int = 0) -> list[dict]:
    """GOLDEN_CASE-like variations, used only by the smoke test (never for results)."""
    import copy
    import random

    from ..prompt import GOLDEN_CASE

    rng = random.Random(seed)
    names = ["Inbox", "Compose", "Weekly update", "Invoice #4821", "Settings", "Search", "Profile", "Help", "Sign out"]
    roles = ["link", "button", "textbox", "tab"]
    out = []
    for i in range(n):
        c = copy.deepcopy(GOLDEN_CASE)
        k = rng.randint(3, 8)
        els = []
        for j in range(k):
            els.append({"id": 10 + j, "role": rng.choice(roles), "name": rng.choice(names),
                        "box": {"x": rng.randint(0, 1000), "y": 60 + 50 * j, "w": rng.randint(80, 600), "h": 40}})
        ans = rng.choice(els)
        c.update(id=f"smoke-{i}", elements=els, answer=ans["id"], command=f"open {ans['name']}",
                 gaze={"x": ans["box"]["x"] + ans["box"]["w"] / 2 + rng.gauss(0, 60), "y": ans["box"]["y"] + 20 + rng.gauss(0, 60)},
                 sigma=60, split="train")
        out.append(c)
    return out
