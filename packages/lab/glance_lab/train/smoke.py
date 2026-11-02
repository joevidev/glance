"""Smoke test: 16 synthetic cases, 2 optimizer steps, save, sample. Writes results/train/smoke.json.

python -m glance_lab.train.smoke

Sampling latency here is training-sampler latency, NOT serving latency.
"""
from __future__ import annotations

import json
import sys
import time
import traceback

from ..common import TRAIN_LOG, require_env
from . import core


def main() -> None:
    # optional: python -m glance_lab.train.smoke <base_model_id> <tag>  -> smoke_<tag>.json, status_<tag>.json
    base = sys.argv[1] if len(sys.argv) > 1 else core.BASE_MODEL
    tag = sys.argv[2] if len(sys.argv) > 2 else ""
    sfx = f"_{tag}" if tag else ""
    core.use_format(core.format_name_for(base))
    out: dict = {"base_model": base, "tokenizer": core.TOKENIZER_MODEL, "timings_s": {}, "ok": False}
    path = TRAIN_LOG / f"smoke{sfx}.json"
    TRAIN_LOG.mkdir(parents=True, exist_ok=True)

    def save() -> None:
        path.write_text(json.dumps(out, indent=2))

    status = core.Status(base_model=base, path=TRAIN_LOG / f"status{sfx}.json" if tag else None).start()
    service = None
    try:
        key = require_env("FIREWORKS_API_KEY")
        from fireworks.training.sdk import AdamParams

        t = time.perf_counter()
        tok = core.load_tokenizer()
        out["timings_s"]["tokenizer_load"] = round(time.perf_counter() - t, 2)
        stop_id = core.special_id(tok, core.ACTIVE.stop_tag)
        cases = core.synthetic_cases(16)
        datums = [core.build_datum(tok, c) for c in cases]
        assert all(d is not None for d in datums)
        out["example_tokens"] = [d.model_input.length for d in datums[:3]]
        save()

        status.update(state="creating_client", total_steps=2)
        t = time.perf_counter()
        service = core.make_service(key)
        tc = core.create_training_client(service, 16, status, base_model=base)
        out["timings_s"]["client_creation"] = round(time.perf_counter() - t, 2)
        out["session"], out["run_id"] = service.training_session_id, tc.run_id
        status.update(session=out["session"], run_id=out["run_id"])
        core.log_job("session", str(out["session"]))
        core.log_job("run", str(out["run_id"]))
        save()

        adam = AdamParams(learning_rate=1e-4, beta1=0.9, beta2=0.999, eps=1e-8, weight_decay=0.0, grad_clip_norm=1.0)
        status.update(state="training")
        steps = []
        for s in range(2):
            t = time.perf_counter()
            fb = tc.forward_backward(datums, "cross_entropy").result()
            t_fb = time.perf_counter() - t
            t = time.perf_counter()
            tc.optim_step(adam).result()
            t_opt = time.perf_counter() - t
            steps.append({"step": s + 1, "forward_backward_s": round(t_fb, 2), "optim_step_s": round(t_opt, 2),
                          "metrics": {k: float(v) for k, v in (getattr(fb, "metrics", None) or {}).items()}})
            status.update(step=s + 1)
            out["steps"] = steps
            save()

        status.update(state="saving")
        t = time.perf_counter()
        snap = tc.save_weights_for_sampler("smoke-1").result().path
        out["timings_s"]["save_weights_for_sampler"] = round(time.perf_counter() - t, 2)
        core.log_job("sampler_checkpoint", snap)
        out["snapshot"] = snap
        save()

        status.update(state="sampling")
        t = time.perf_counter()
        sampler = service.create_sampling_client(model_path=snap, tokenizer=tok)
        out["timings_s"]["sampler_startup"] = round(time.perf_counter() - t, 2)
        save()
        samples = []
        for c in cases[:4]:
            toks = core.prompt_tokens(tok, c)
            text, n_out, dt = core.sample_one(sampler, tok, toks, stop_id)
            samples.append({"id": c["id"], "answer": c["answer"], "raw": text, "prompt_tokens": len(toks),
                            "out_tokens": n_out, "latency_s": round(dt, 3)})
            out["samples"] = samples
            save()
        sampler.close()
        lat = [s["latency_s"] for s in samples]
        out["timings_s"]["sample_latency_first"] = lat[0]
        out["timings_s"]["sample_latency_median_rest"] = sorted(lat[1:])[len(lat[1:]) // 2]
        out["note"] = "training-sampler latency, NOT serving latency; 2 steps of 16 synthetic cases, so predictions are meaningless"
        out["ok"] = True
        status.update(state="done")
    except BaseException as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
        out["traceback"] = traceback.format_exc()[-3000:]
        status.error(out["error"])
        status.update(state="failed")
        raise
    finally:
        if service is not None:
            try:
                service.delete_training_session()
                out["session_deleted"] = True
            except Exception as e:  # noqa: BLE001
                out["session_deleted"] = f"failed: {e}"
            try:
                service.close()
            except Exception:  # noqa: BLE001
                pass
        save()
        status.stop()


if __name__ == "__main__":
    main()
