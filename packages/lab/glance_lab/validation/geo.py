"""Validation of the "geo" prompt on a HOLDOUT OF TRAIN SITES (never the locked test set).

Decision rule fixed BEFORE any number existed (coordinator, 2026-11-02 ~13:47 PT):
  VERDICT: GO if glm-5p3 with the geo prompt beats the same model with the plain prompt by >= 5.0
  accuracy points overall on the same validation cases and settings; otherwise NO-GO.
No re-running until it passes. Same settings as the open-model systems: one user message, temperature 0,
max_tokens 8192, transient errors retried and never scored as wrong, unparseable or truncated replies are wrong.

  cd packages/lab && uv run python -m glance_lab.validation.geo [--limit N]
"""
from __future__ import annotations

import asyncio
import collections
import json
import random
import sys
import time

from openai import AsyncOpenAI

from glance_lab.common import DATASET, RESULTS, read_jsonl, require_env
from glance_lab.prompt import build_prompt, parse_decision

MODEL = "accounts/fireworks/models/glm-5p3"
IN_PRICE, OUT_PRICE = 1.40, 4.40            # USD per 1M tokens, same as results/PRICING.md
N_SITES, PER_SITE, SEED = 4, 60, 20261102
OUT = RESULTS / "geo_validation"


def pick_cases() -> tuple[list[str], list[dict]]:
    train = read_jsonl(DATASET / "train.jsonl")
    sites = sorted({c["site"] for c in train})
    chosen = [sites[i] for i in (3, 10, 17, 24)][:N_SITES]          # fixed, deterministic, written to the report
    rng = random.Random(SEED)
    cases: list[dict] = []
    for s in chosen:
        cs = [c for c in train if c["site"] == s]
        rng.shuffle(cs)
        cases += cs[:PER_SITE]
    return chosen, cases


async def one(client, sem, case, variant, stats):
    prompt = build_prompt(case, variant=variant)
    async with sem:
        for attempt in range(8):
            t0 = time.time()
            try:
                r = await client.chat.completions.create(
                    model=MODEL, messages=[{"role": "user", "content": prompt}], temperature=0, max_tokens=8192)
                break
            except Exception as e:                                   # 429 / 5xx / connection: retry, never score
                stats["retries"] += 1
                await asyncio.sleep(min(60, 4 * 2 ** attempt))
        else:
            return {"id": case["id"], "variant": variant, "pred": None, "score": 0, "error": "gave_up", "cost": 0.0}
    ch = r.choices[0]
    text = ch.message.content or ""
    pred = parse_decision(text)
    u = r.usage
    cost = (u.prompt_tokens * IN_PRICE + u.completion_tokens * OUT_PRICE) / 1e6
    return {"id": case["id"], "site": case["site"], "variant": variant, "type": case["command_type"], "sigma": case["sigma"],
            "pred": pred, "answer": case["answer"], "score": int(pred == case["answer"]),
            "truncated": ch.finish_reason == "length", "latency_ms": round((time.time() - t0) * 1000), "cost": cost}


async def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    sites, cases = pick_cases()
    if limit:
        cases = cases[:limit]
    client = AsyncOpenAI(base_url="https://api.fireworks.ai/inference/v1", api_key=require_env("FIREWORKS_API_KEY"), timeout=300, max_retries=0)
    sem = asyncio.Semaphore(8)
    stats = {"retries": 0}
    jobs = [one(client, sem, c, v, stats) for c in cases for v in ("plain", "geo")]
    rows, done = [], 0
    for fut in asyncio.as_completed(jobs):
        rows.append(await fut)
        done += 1
        if done % 40 == 0:
            print(f"[geo_validation] {done}/{len(jobs)} done, retries {stats['retries']}", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "rows.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    def acc(v, f=lambda r: True):
        xs = [r["score"] for r in rows if r["variant"] == v and f(r)]
        return (100 * sum(xs) / len(xs), len(xs)) if xs else (float("nan"), 0)

    p, n = acc("plain"); g, _ = acc("geo")
    verdict = "GO" if g - p >= 5.0 else "NO-GO"
    bytype = {t: (acc("plain", lambda r, t=t: r["type"] == t), acc("geo", lambda r, t=t: r["type"] == t)) for t in ("deictic", "role", "partial_name", "ordinal")}
    cost = {v: sum(r["cost"] for r in rows if r["variant"] == v) for v in ("plain", "geo")}
    trunc = {v: sum(1 for r in rows if r["variant"] == v and r.get("truncated")) for v in ("plain", "geo")}
    unp = {v: sum(1 for r in rows if r["variant"] == v and r["pred"] is None) for v in ("plain", "geo")}
    md = [f"VERDICT: {verdict}", "",
          "# Geo-prompt validation on a holdout of TRAIN sites (never the locked test set)", "",
          f"Rule fixed before any number existed: GO if geo beats plain by >= 5.0 points overall. Model {MODEL}, temperature 0, max_tokens 8192, one user message, same cases.",
          f"Holdout sites (sorted train sites, indices 3, 10, 17, 24): {', '.join(sites)}. {PER_SITE} cases per site, seed {SEED}. n = {n} cases per prompt.", "",
          "| prompt | accuracy | unparseable | truncated | cost USD |", "|---|---|---|---|---|",
          f"| plain | {p:.1f}% | {unp['plain']} | {trunc['plain']} | {cost['plain']:.2f} |",
          f"| geo | {g:.1f}% | {unp['geo']} | {trunc['geo']} | {cost['geo']:.2f} |", "",
          f"Difference: {g - p:+.1f} points. Transient API errors retried: {stats['retries']} (never scored as wrong).", "",
          "| command type | plain | geo | n |", "|---|---|---|---|"]
    for t, ((pa, pn), (ga, _)) in bytype.items():
        md.append(f"| {t} | {pa:.1f}% | {ga:.1f}% | {pn} |")
    md += ["", "Run by the coordinator (not lab-systems) because lab-systems was busy with harness_vote; code: glance_lab/validation/geo.py; rows: results/geo_validation/rows.jsonl."]
    if limit:
        md[0] = f"VERDICT: SMOKE-TEST-ONLY (limit {limit})"
    (RESULTS / ("geo_validation_smoke.md" if limit else "geo_validation.md")).write_text("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    asyncio.run(main())
