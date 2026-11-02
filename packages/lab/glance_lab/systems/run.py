"""Run the comparison systems on the locked test set.

    python -m glance_lab.systems.run --systems open_base,frontier [--limit N]

Systems (file name = system name = results/rows/<name>.jsonl):
  raw_gaze        box containing the gaze point, none -> wrong      (no model)
  nearest         nearest box to the gaze                           (no model)
  open_cmd_only   open model, command-only prompt
  open_base       open model, gaze + command prompt
  frontier        OpenAI frontier model, gaze + command prompt (same text as open_base)
  harness_top5    open model, gaze prompt restricted to the 5 nearest elements
  open_base_geo / frontier_geo   as open_base / frontier but with the geo prompt (build_prompt variant="geo")
  harness_vote    open model, gaze prompt, majority of 5 samples at temperature 0.7
                  (ties -> the tied element nearest the gaze; latency = slowest of the 5
                  parallel calls, cost = sum of the 5)

A parse failure or an API failure is a wrong answer (pred null, score 0); it is never dropped.
On the real test set the runner refuses unless manifest.json says locked and the sha256
of test.jsonl equals manifest test_sha256. A run with --limit or a custom --cases file
writes to results/smoke/ (never results/rows/).
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import hashlib
import json
import sys
from pathlib import Path

from ..common import DATASET, RESULTS, ROWS, read_jsonl
from ..prompt import build_prompt, parse_decision
from . import geometry
from .llm import CACHE, Completion, ModelSpec, cached_call, frontier_spec, make_client, open_spec

ALL_SYSTEMS = ["raw_gaze", "nearest", "open_cmd_only", "open_base", "frontier", "harness_top5", "harness_vote",
               "open_base_geo", "frontier_geo"]
REAL_TEST = DATASET / "test.jsonl"
SMOKE = RESULTS / "smoke"
VOTE_N = 5
VOTE_TEMP = 0.7


def check_locked() -> dict:
    man_p = DATASET / "manifest.json"
    if not man_p.exists():
        raise SystemExit("refusing: data/dataset/manifest.json does not exist (dataset not built)")
    man = json.loads(man_p.read_text())
    if man.get("locked") is not True:
        raise SystemExit("refusing: manifest.json does not say locked: true")
    sha = hashlib.sha256(REAL_TEST.read_bytes()).hexdigest()
    if sha != man.get("test_sha256"):
        raise SystemExit(f"refusing: sha256(test.jsonl)={sha[:12]}... != manifest test_sha256")
    return man


def make_row(case: dict, system: str, pred, latency_ms, cost, raw, finish_reason=None, retries=0, transient=False) -> dict:
    return {"id": case["id"], "site": case["site"], "system": system, "sigma": case["sigma"], "answer": case["answer"],
            "pred": pred, "score": int(pred is not None and pred == case["answer"]),
            "latency_ms": latency_ms, "cost_usd": cost, "raw": raw,
            "finish_reason": finish_reason, "retries": retries, "_transient": transient}


def row_from_completion(case: dict, system: str, c: Completion) -> dict:
    if c.error is not None:
        return make_row(case, system, None, c.latency_ms, c.cost_usd, f"ERROR: {c.error}", None, c.retries, c.transient)
    return make_row(case, system, parse_decision(c.text), c.latency_ms, c.cost_usd, c.text, c.finish_reason, c.retries)


async def run_llm_case(label: str, case: dict, ctx: dict) -> dict:
    """label = system name + optional suffix (e.g. open_base_flash): used for the cache dir and the row's system field."""
    system = label[: len(label) - len(ctx.get("suffix", ""))] if ctx.get("suffix") else label
    variant = "plain"
    if system.endswith("_geo"):   # geo prompt: elements sorted by distance to the gaze, annotated with d=<px> (computed in code)
        system, variant = system[:-4], "geo"
    sem, cd = ctx["sem"], ctx["cache_dir"]
    open_s, fr_s = ctx["open_spec"], ctx["frontier_spec"]
    if system == "open_cmd_only":
        c = await cached_call(ctx["open_client"], open_s, label, case["id"], build_prompt(case, with_gaze=False), 0.0, sem, cache_dir=cd)
        return row_from_completion(case, label, c)
    if system == "open_base":
        c = await cached_call(ctx["open_client"], open_s, label, case["id"], build_prompt(case, with_gaze=True, variant=variant), 0.0, sem, cache_dir=cd)
        return row_from_completion(case, label, c)
    if system == "frontier":
        c = await cached_call(ctx["frontier_client"], fr_s, label, case["id"], build_prompt(case, with_gaze=True, variant=variant), 0.0, sem, cache_dir=cd)
        return row_from_completion(case, label, c)
    if system == "harness_top5":
        sub = dict(case, elements=geometry.top_k(case, 5))
        c = await cached_call(ctx["open_client"], open_s, label, case["id"], build_prompt(sub, with_gaze=True), 0.0, sem, cache_dir=cd)
        return row_from_completion(case, label, c)
    if system == "harness_vote":
        prompt = build_prompt(case, with_gaze=True)
        cs = await asyncio.gather(*[cached_call(ctx["open_client"], open_s, label, case["id"], prompt, VOTE_TEMP, sem, sample=i, cache_dir=cd)
                                    for i in range(VOTE_N)])
        return vote_row(case, label, cs)
    raise ValueError(system)


def vote_row(case: dict, system: str, cs: list[Completion]) -> dict:
    preds = [parse_decision(c.text) if c.error is None else None for c in cs]
    ids = {e["id"] for e in case["elements"]}
    votes = collections.Counter(p for p in preds if p is not None and p in ids)
    pred = None
    if votes:
        top = max(votes.values())
        tied = [p for p, n in votes.items() if n == top]
        if len(tied) == 1:
            pred = tied[0]
        else:  # tie: the tied element nearest the gaze (deterministic)
            order = {e["id"]: i for i, e in enumerate(geometry.ranked_by_distance(case))}
            pred = min(tied, key=lambda p: order[p])
    lat = [c.latency_ms for c in cs if c.latency_ms is not None]
    costs = [c.cost_usd for c in cs]
    cost = None if any(x is None for x in costs) else sum(costs)
    raw = " || ".join((c.text if c.error is None else f"ERROR: {c.error}") or "" for c in cs)
    fr = ",".join(sorted({str(c.finish_reason) for c in cs}))
    return make_row(case, system, pred, max(lat) if lat else None, cost, raw, fr, sum(c.retries for c in cs),
                    any(c.error is not None and c.transient for c in cs))


def run_geometry(system: str, case: dict) -> dict:
    pred = geometry.raw_gaze(case) if system == "raw_gaze" else geometry.nearest(case)
    return make_row(case, system, pred, 0.0, 0.0, None)


async def run_system(system: str, cases: list[dict], ctx: dict, *, progress_every: int = 50, passes: int = 6,
                     pass_sleep: float = 30.0) -> list[dict]:
    """Run every case. A transient infrastructure error (429, connection, 5xx) is never a wrong answer: those cases are
    retried (in-call backoff, then whole extra passes) until they return. Non-transient failures stay wrong."""
    if system in ("raw_gaze", "nearest"):
        return [run_geometry(system, c) for c in cases]
    label = system + ctx.get("suffix", "")
    done = 0
    out: list[dict | None] = [None] * len(cases)

    async def one(i: int, case: dict):
        nonlocal done
        out[i] = await run_llm_case(label, case, ctx)
        done += 1
        if done % progress_every == 0 or done == len(cases):
            ok = sum(1 for r in out if r is not None and r["score"])
            err = sum(1 for r in out if r is not None and (r["raw"] or "").startswith("ERROR") )
            print(f"[{label}] {done}/{len(cases)} done, correct so far {ok}, errors {err}", file=sys.stderr, flush=True)

    await asyncio.gather(*[one(i, c) for i, c in enumerate(cases)])
    for ps in range(1, passes + 1):
        bad = [i for i, r in enumerate(out) if r["_transient"]]
        if not bad:
            break
        print(f"[{label}] pass {ps}: {len(bad)} cases hit transient errors, retrying in {pass_sleep:.0f}s", file=sys.stderr, flush=True)
        await asyncio.sleep(pass_sleep)
        await asyncio.gather(*[one(i, cases[i]) for i in bad])
        for i in bad:
            out[i]["retries"] += ps
    return out  # type: ignore[return-value]


def write_rows(path: Path, rows: list[dict]) -> None:
    rows = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def build_ctx(systems: list[str], concurrency: int, open_model: str, frontier_model: str, cache_dir: Path, suffix: str = "") -> dict:
    ctx = {"sem": asyncio.Semaphore(concurrency), "cache_dir": cache_dir, "suffix": suffix,
           "open_spec": open_spec(open_model), "frontier_spec": frontier_spec(frontier_model)}
    if any(s in systems for s in ("open_cmd_only", "open_base", "harness_top5", "harness_vote", "open_base_geo")):
        ctx["open_client"] = make_client(ctx["open_spec"])
    if "frontier" in systems or "frontier_geo" in systems:
        ctx["frontier_client"] = make_client(ctx["frontier_spec"])
    return ctx


async def amain(a) -> None:
    systems = [s.strip() for s in a.systems.split(",") if s.strip()]
    bad = [s for s in systems if s not in ALL_SYSTEMS]
    if bad:
        raise SystemExit(f"unknown systems {bad}; choose from {ALL_SYSTEMS}")
    cases_path = REAL_TEST if a.cases is None else Path(a.cases)
    real = cases_path.resolve() == REAL_TEST.resolve()
    if real:
        man = check_locked()
        print(f"manifest locked, test sha ok, n_test={man.get('n_test', '?')}", file=sys.stderr)
    cases = read_jsonl(cases_path)
    if a.limit:
        cases = cases[: a.limit]
    full_real = real and not a.limit
    out_dir = ROWS if full_real else SMOKE / "rows"
    if a.out_dir:
        out_dir = Path(a.out_dir)
    print(f"{len(cases)} cases from {cases_path}; writing rows to {out_dir}", file=sys.stderr)
    ctx = build_ctx(systems, a.concurrency, a.open_model, a.frontier_model, Path(a.cache_dir), a.name_suffix)
    for s in systems:
        rows = await run_system(s, cases, ctx)
        incomplete = sum(1 for r in rows if r.get("_transient"))
        target = out_dir
        if incomplete:   # unresolved infrastructure errors: never publish these as results
            target = out_dir.parent / (out_dir.name + "_incomplete")
            print(f"WARNING {s}: {incomplete} rows hit unresolved transient/billing errors; writing to {target}, NOT {out_dir}", file=sys.stderr, flush=True)
        write_rows(target / f"{s}{a.name_suffix if s not in ('raw_gaze', 'nearest') else ''}.jsonl", rows)
        n = len(rows)
        acc = sum(r["score"] for r in rows) / n * 100 if n else float("nan")
        costs = [r["cost_usd"] for r in rows]
        cost = None if any(c is None for c in costs) else sum(costs)
        ntrunc = sum(1 for r in rows if "length" in str(r.get("finish_reason")))
        nret = sum(1 for r in rows if r.get("retries"))
        nerr = sum(1 for r in rows if (r["raw"] or "").startswith("ERROR"))
        npf = sum(1 for r in rows if r["pred"] is None)
        print(f"{s}: n={n} acc={acc:.1f}% parse_fail_or_none={npf} api_errors={nerr} truncated_length={ntrunc} rows_that_needed_retries={nret} total_cost_usd={cost}", flush=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--systems", default="open_base")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--cases", default=None, help="custom cases jsonl (fixture); default is the locked real test set")
    p.add_argument("--out-dir", default=None)
    p.add_argument("--concurrency", type=int, default=16)
    p.add_argument("--open-model", default="accounts/fireworks/models/glm-5p3-flash",
                   help="must equal the LoRA base model; read results/train/NOTES.md")
    p.add_argument("--frontier-model", default="gpt-6-astra")
    p.add_argument("--name-suffix", default="", help="appended to LLM system names (cache dir, rows file, system field), e.g. _flash")
    p.add_argument("--cache-dir", default=str(CACHE))
    asyncio.run(amain(p.parse_args()))


if __name__ == "__main__":
    main()
