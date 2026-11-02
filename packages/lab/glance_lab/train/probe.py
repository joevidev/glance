"""Capacity probe: try to get a serverless LoRA session on several base models and run ONE
forward_backward on random token ids. Only measures whether capacity exists and how long
creation/one step take; the data is meaningless. Writes results/train/probe.json.

python -m glance_lab.train.probe accounts/fireworks/models/qwen3p8-27b ...
"""
from __future__ import annotations

import json
import sys
import threading
import time

from ..common import TRAIN_LOG, require_env
from . import core

LOCK = threading.Lock()
OUT: dict = {}


def save() -> None:
    (TRAIN_LOG / "probe.json").write_text(json.dumps(OUT, indent=2))


def probe(model: str, key: str, max_wait_s: float) -> None:
    from fireworks.training.sdk import AdamParams, Datum, ModelInput

    r: dict = {"result": "running", "started": time.strftime("%H:%M:%S")}
    with LOCK:
        OUT[model] = r
        save()
    service = None
    try:
        service = core.make_service(key)
        t = time.perf_counter()
        tc = core.create_training_client(service, 16, None, max_wait_s=max_wait_s, base_model=model)
        r["client_creation_s"] = round(time.perf_counter() - t, 2)
        r["session"] = service.training_session_id
        core.log_job("probe_session", f"{model} {r['session']}")
        toks = list(range(1000, 1100))
        d = Datum(model_input=ModelInput.from_ints(toks[:-1]),
                  loss_fn_inputs={"target_tokens": toks[1:], "weights": [0.0] * 90 + [1.0] * 9})
        t = time.perf_counter()
        tc.forward_backward([d], "cross_entropy").result()
        tc.optim_step(AdamParams(learning_rate=1e-5)).result()
        r["one_step_s"] = round(time.perf_counter() - t, 2)
        r["result"] = "ok"
    except BaseException as e:  # noqa: BLE001
        r["result"] = "failed"
        r["error"] = f"{type(e).__name__}: {e}"[:400]
    finally:
        if service is not None:
            try:
                service.delete_training_session()
                r["session_deleted"] = True
            except Exception as e:  # noqa: BLE001
                r["session_deleted"] = f"failed: {e}"[:200]
        r["finished"] = time.strftime("%H:%M:%S")
        with LOCK:
            save()


def main() -> None:
    models = sys.argv[1:]
    key = require_env("FIREWORKS_API_KEY")
    ths = [threading.Thread(target=probe, args=(m, key, 600.0)) for m in models]
    for t in ths:
        t.start()
    for t in ths:
        t.join()


if __name__ == "__main__":
    main()
