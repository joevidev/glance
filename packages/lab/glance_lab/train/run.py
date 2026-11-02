"""Train the Glance LoRA on Fireworks serverless training and score the locked test set.

    python -m glance_lab.train.run [--dry-run] [--max-train N] [--max-test N]

Reads data/dataset/{train,test}.jsonl (refuses unless manifest.json says "locked": true),
trains 1 epoch (cap 3000 cases, batch 16, lr 1e-4, rank 16, alpha 32) on the assistant
completion only, saves a sampler checkpoint, then scores EVERY test case greedily
and writes results/rows/lora.jsonl plus results/train/{status,summary}.json.

LATENCY CAVEAT: sampling goes through the Fireworks training sampler (serverless
training session on shared GPUs). The latency_ms recorded per row is NOT serving
latency; it is kept only for audit. cost_usd is an ESTIMATE from the serverless
price table (prefill + sample tokens), not a billed amount.
"""
from __future__ import annotations

import argparse
import json
import random
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from ..common import DATASET, ROWS, TRAIN_LOG, read_jsonl, require_env
from . import core


def load_dataset(max_train: int, max_test: int | None, seed: int = 0) -> tuple[list[dict], list[dict], dict]:
    manifest_path = DATASET / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"{manifest_path} missing: dataset not built yet")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("locked") is not True:
        raise SystemExit('manifest.json does not say "locked": true; refusing to run')
    import hashlib

    sha = hashlib.sha256((DATASET / "test.jsonl").read_bytes()).hexdigest()
    if manifest.get("test_sha256") and sha != manifest["test_sha256"]:
        raise SystemExit(f"test.jsonl sha256 {sha} does not match manifest {manifest['test_sha256']}; refusing to run")
    train = read_jsonl(DATASET / "train.jsonl")
    test = read_jsonl(DATASET / "test.jsonl")
    check_disjoint(train, test)
    random.Random(seed).shuffle(train)
    train = train[:max_train]
    if max_test:
        test = test[:max_test]
    return train, test, manifest


def check_disjoint(train: list[dict], test: list[dict]) -> None:
    tr, te = {c["id"] for c in train}, {c["id"] for c in test}
    both = tr & te
    assert not both, f"{len(both)} test case ids appear in train, e.g. {sorted(both)[:3]}"
    assert all(c.get("split", "train") == "train" for c in train), "train.jsonl contains non-train split rows"


def mean_loss(fb) -> float | None:
    m = getattr(fb, "metrics", None) or {}
    s = m.get("loss:sum")
    n = m.get("response_tokens") or m.get("num_loss_tokens")
    return None if s is None or not n else float(s) / float(n)


def score_snapshot(service, tok, snap: str, test: list[dict], stop_id: int, concurrency: int, status, summary: dict, sfx: str = "", variant: str = "plain", system: str = "lora") -> list[dict]:
    """Greedy-sample every test case from a sampler checkpoint. Failed samples become score-0 rows with raw 'ERROR: ...'."""
    status.update(state="scoring", test_total=len(test), scored=0)
    t = time.perf_counter()
    sampler = core.retry_call(lambda: service.create_sampling_client(model_path=snap, tokenizer=tok), "create sampler", status)
    summary["sampler_startup_s"] = round(time.perf_counter() - t, 2)

    def score(c: dict) -> dict:
        toks = core.prompt_tokens(tok, c, variant)
        try:
            text, n_out, dt = core.retry_call(lambda: core.sample_one(sampler, tok, toks, stop_id),
                                              f"sample {c['id']}", status, max_total_s=600.0)
            return core.make_row(c, text, len(toks), n_out, dt, system)
        except Exception as e:  # noqa: BLE001  (non-transient or retries exhausted: reported as sample_errors, score 0)
            err = f"{type(e).__name__}: {e}"
            status.error(f"sample failed for {c['id']}: {err}")
            row = core.make_row(c, None, len(toks), 0, None, system)
            row["raw"] = f"ERROR: {err}"[:300]
            return row

    rows: list[dict] = []
    t_score = time.perf_counter()
    partial = TRAIN_LOG / f"lora{sfx}.partial.jsonl"
    partial.write_text("")
    with ThreadPoolExecutor(concurrency) as ex, partial.open("a") as pf:
        for i, row in enumerate(ex.map(score, test), 1):
            rows.append(row)
            pf.write(json.dumps(row, ensure_ascii=False) + "\n")
            if i % 25 == 0:
                pf.flush()
                status.update(scored=i, running_acc=round(sum(r["score"] for r in rows) / i, 4))
    sampler.close()
    summary["score_s"] = round(time.perf_counter() - t_score, 1)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="build datums and estimate cost; no network calls to Fireworks")
    ap.add_argument("--max-train", type=int, default=3000)
    ap.add_argument("--max-test", type=int, default=None, help="debug only; the real run scores every test case")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--rank", type=int, default=None, help="default 16 for GLM, 8 for Muse Glimmer")
    ap.add_argument("--concurrency", type=int, default=8, help="parallel sampling requests during scoring")
    ap.add_argument("--max-seq-len", type=int, default=8192)
    ap.add_argument("--base-model", default=core.BASE_MODEL)
    ap.add_argument("--prompt-variant", choices=["plain", "geo"], default="plain",
                    help="geo = build_prompt(variant='geo'); rows go to results/rows/lora_geo.jsonl as system lora_geo")
    ap.add_argument("--lr-schedule", choices=["constant", "linear"], default="constant",
                    help="linear: lr * (total_steps - step) / total_steps, i.e. decays to ~0 by the last step")
    ap.add_argument("--tag", default="", help="suffix for status/summary files and rows file when running more than one run")
    ap.add_argument("--ckpt-name", default="glance-lora-v1", help="<=17 chars")
    ap.add_argument("--ckpt-every", type=int, default=40, help="also save a sampler checkpoint every N steps (storage is free)")
    ap.add_argument("--score-only", action="store_true", help="skip training; score the checkpoint given by --snapshot")
    ap.add_argument("--snapshot", default=None, help="sampler checkpoint path from jobs.log, for --score-only")
    args = ap.parse_args()
    fmt = core.use_format(core.format_name_for(args.base_model))
    args.rank = args.rank or fmt.default_rank
    if fmt.name == "muse":
        if args.prompt_variant != "plain":
            raise SystemExit("Muse run supports --prompt-variant plain only")
        args.tag = args.tag or "muse"
        system = fmt.rows_system
    else:
        if args.prompt_variant == "geo" and not args.tag:
            args.tag = "geo"  # separate status_geo.json / summary_geo.json; the v1 files stay untouched
        system = "lora" if args.prompt_variant == "plain" else "lora_geo"
    assert len(args.ckpt_name) <= 17, "checkpoint name must be <=17 chars"
    if args.score_only and not args.snapshot:
        raise SystemExit("--score-only needs --snapshot <path from results/train/jobs.log>")

    train, test, manifest = load_dataset(args.max_train, args.max_test)
    tok = core.load_tokenizer()
    stop_id = core.special_id(tok, fmt.stop_tag)
    datums, dropped, ntok = [], 0, 0
    for c in train:
        d = core.build_datum(tok, c, args.max_seq_len, args.prompt_variant)
        if d is None:
            dropped += 1
            continue
        datums.append(d)
        ntok += d.model_input.length
    total_steps = -(-len(datums) // args.batch)
    table_train_cost = ntok / 1e6 * fmt.price_train
    est_train_cost = 0.0 if fmt.name == "muse" else table_train_cost   # Muse LoRA SFT is free until 2026-11-30 (docs)
    lens = sorted(len(core.prompt_tokens(tok, c, args.prompt_variant)) + 12 for c in train)
    test_tok = sum(len(core.prompt_tokens(tok, c, args.prompt_variant)) for c in test)
    print(f"format={fmt.name} tokenizer={fmt.tokenizer} rank={args.rank} approx sequence length: max {lens[-1]}, "
          f">2048: {sum(l > 2048 for l in lens)}, >4096: {sum(l > 4096 for l in lens)}, >8192: {sum(l > 8192 for l in lens)} (of {len(lens)} train cases)")
    print(f"scoring {len(test)} test cases: {test_tok} prompt tokens, est sampling cost ${core.estimate_cost(test_tok, len(test) * 14):.3f} "
          f"(prefill ${fmt.price_prefill}/1M, sample ${fmt.price_sample}/1M, table values)")
    print(f"train cases {len(datums)} (dropped too long: {dropped}), tokens {ntok}, steps {total_steps}, "
          f"est train cost ${est_train_cost:.2f} (table rate would be ${table_train_cost:.2f}); test cases {len(test)}")
    if args.dry_run:
        print("dry run: stopping before any Fireworks call")
        return

    sfx = f"_{args.tag}" if args.tag else ""
    status = core.Status(base_model=args.base_model, path=TRAIN_LOG / f"status{sfx}.json" if args.tag else None).start()
    status.update(state="starting", total_steps=total_steps)
    summary: dict = {
        "base_model": args.base_model, "tokenizer": fmt.tokenizer, "format": fmt.name, "train_cost_at_table_rate_usd": round(table_train_cost, 2), "rank": args.rank, "alpha": 32,
        "lr": args.lr, "lr_schedule": args.lr_schedule, "prompt_variant": args.prompt_variant, "system": system, "epochs": 1, "batch": args.batch, "train_cases": len(datums), "train_tokens": ntok,
        "test_cases": len(test), "dropped_too_long": dropped, "manifest": manifest,
        "est_train_cost_usd": round(est_train_cost, 4), "cost_note": "ESTIMATE from price table, not billed amounts",
        "latency_note": "training-sampler latency, NOT serving latency",
    }
    service = None
    have_snapshot = False  # once a checkpoint exists, keep the session alive on failure so it can be re-scored
    try:
        key = require_env("FIREWORKS_API_KEY")
        from fireworks.training.sdk import AdamParams

        t = time.perf_counter()
        service = core.make_service(key)
        if args.score_only:
            snap = args.snapshot
            summary["score_only"] = True
            summary["snapshot"] = snap
        else:
            tc = core.create_training_client(service, args.rank, status, base_model=args.base_model)
            summary["client_creation_s"] = round(time.perf_counter() - t, 2)
            status.update(session=service.training_session_id, run_id=tc.run_id)
            core.log_job("session", f"{args.base_model} {service.training_session_id}")
            core.log_job("run", str(tc.run_id))

            adam = AdamParams(learning_rate=args.lr, beta1=0.9, beta2=0.999, eps=1e-8, weight_decay=0.0, grad_clip_norm=1.0)
            status.update(state="training")
            t_train = time.perf_counter()
            losses = []
            for step in range(total_steps):
                batch = datums[step * args.batch:(step + 1) * args.batch]
                t = time.perf_counter()
                lr_t = core.lr_at(args.lr, args.lr_schedule, step, total_steps)
                adam = AdamParams(learning_rate=lr_t, beta1=0.9, beta2=0.999, eps=1e-8, weight_decay=0.0, grad_clip_norm=1.0)
                fb = core.retry_call(lambda: tc.forward_backward(batch, "cross_entropy").result(), f"fwd_bwd step {step + 1}", status)
                core.retry_call(lambda: tc.optim_step(adam).result(), f"optim step {step + 1}", status)
                dt = time.perf_counter() - t
                loss = mean_loss(fb)
                losses.append({"step": step + 1, "loss": loss, "s": round(dt, 2), "lr": lr_t})
                status.update(step=step + 1, last_loss=loss, sec_per_step=round(dt, 2))
                if (step + 1) % 10 == 0 or step == 0:
                    print(f"step {step + 1}/{total_steps} loss={loss} {dt:.1f}s", flush=True)
                if args.ckpt_every and (step + 1) % args.ckpt_every == 0 and step + 1 < total_steps:
                    p = core.retry_call(lambda: tc.save_weights_for_sampler(f"glance-s{step + 1:04d}").result().path, "save ckpt", status)
                    core.log_job("sampler_checkpoint", f"step{step + 1} {p}")
                    have_snapshot = True
            summary["train_s"] = round(time.perf_counter() - t_train, 1)
            summary["losses"] = losses

            status.update(state="saving")
            t = time.perf_counter()
            snap = core.retry_call(lambda: tc.save_weights_for_sampler(args.ckpt_name).result().path, "save final", status)
            summary["save_s"] = round(time.perf_counter() - t, 2)
            summary["snapshot"] = snap
            core.log_job("sampler_checkpoint", f"final {snap}")
            have_snapshot = True

        rows = score_snapshot(service, tok, snap, test, stop_id, args.concurrency, status, summary, sfx, args.prompt_variant, system)
        assert len(rows) == len(test) and [r["id"] for r in rows] == [c["id"] for c in test]
        ROWS.mkdir(parents=True, exist_ok=True)
        rows_path = ROWS / ("lora_geo.jsonl" if args.prompt_variant == "geo" else fmt.rows_file) if (args.prompt_variant == "geo" or fmt.name == "muse") else ((TRAIN_LOG / f"lora{sfx}.jsonl") if args.tag else (ROWS / "lora.jsonl"))
        summary["rows_path"] = str(rows_path)
        with rows_path.open("w") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        n_err = sum(1 for r in rows if (r["raw"] or "").startswith("ERROR:"))
        summary.update(
            rows=len(rows), accuracy=round(sum(r["score"] for r in rows) / len(rows), 4),
            unparseable=sum(1 for r in rows if r["pred"] is None), sample_errors=n_err,
            est_sampling_cost_usd=round(sum(r["cost_usd"] or 0 for r in rows), 4),
        )
        print(f"scored {len(rows)} rows, accuracy {summary['accuracy']}", flush=True)
        status.update(state="done", scored=len(rows), accuracy=summary["accuracy"])
    except BaseException as e:  # noqa: BLE001
        summary["error"] = f"{type(e).__name__}: {e}"
        summary["traceback"] = traceback.format_exc()[-3000:]
        status.error(summary["error"])
        status.update(state="failed")
        raise
    finally:
        keep = have_snapshot and "error" in summary and not args.score_only
        if service is not None and keep:
            summary["session_deleted"] = False
            summary["note"] = "session kept: checkpoint saved but run failed; re-score with --score-only --snapshot <path in jobs.log>, then delete the session"
            core.log_job("session_kept_open", str(service.training_session_id))
        elif service is not None:
            try:
                service.delete_training_session()
                summary["session_deleted"] = True
            except Exception as e:  # noqa: BLE001
                summary["session_deleted"] = f"failed: {e}"
            try:
                service.close()
            except Exception:  # noqa: BLE001
                pass
        (TRAIN_LOG / f"summary{sfx}.json").write_text(json.dumps(summary, indent=2))
        status.stop()


if __name__ == "__main__":
    main()
