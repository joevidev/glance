"""Validation of the geo prompt on a TRAIN-site holdout (never the test set).

    python -m glance_lab.systems.geo_validation

Fixed rule (set by the coordinator before any number existed): VERDICT GO iff open model glm-5p3 with the geo prompt beats
the same model with the plain prompt by >= 5.0 accuracy points overall on the same cases, same settings. No re-running
until it passes. Holdout: the 4 train sites with the smallest sha256(site), then up to 300 cases from them with the
smallest sha256(case id). Writes results/geo_validation.md (first line = verdict) and results/val_rows/*.jsonl.
"""
from __future__ import annotations

import asyncio
import collections
import hashlib
import json

from ..common import DATASET, RESULTS, read_jsonl
from .run import build_ctx, run_system, write_rows

MODEL = "accounts/fireworks/models/glm-5p3"
THRESH = 5.0


def h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def pick() -> tuple[list[str], list[dict]]:
    man = json.loads((DATASET / "manifest.json").read_text())
    sites = sorted(man["train_sites"], key=h)[:4]
    cases = [c for c in read_jsonl(DATASET / "train.jsonl") if c["site"] in sites]
    cases = sorted(cases, key=lambda c: h(c["id"]))[:300]
    return sites, sorted(cases, key=lambda c: c["id"])


async def main() -> None:
    sites, cases = pick()
    assert all(c["split"] == "train" for c in cases)
    ctx = build_ctx(["open_base", "open_base_geo"], 16, MODEL, "gpt-6-astra", RESULTS / "cache_val")
    out = {}
    for s in ("open_base", "open_base_geo"):
        out[s] = await run_system(s, cases, ctx)
        write_rows(RESULTS / "val_rows" / f"{s}.jsonl", out[s])
    ct = {c["id"]: c["command_type"] for c in cases}

    def acc(rows):
        return sum(r["score"] for r in rows) / len(rows) * 100

    plain, geo = out["open_base"], out["open_base_geo"]
    d = acc(geo) - acc(plain)
    verdict = "GO" if d >= THRESH else "NO-GO"
    cost = {k: sum(r["cost_usd"] or 0 for r in v) for k, v in out.items()}
    lines = [f"VERDICT: {verdict}", "",
             f"Criterion (fixed in advance): GO iff geo minus plain >= +{THRESH} accuracy points overall on the validation holdout. "
             f"Observed: {d:+.2f} points.", "",
             f"Model {MODEL}, temperature 0, max_tokens 8192, same settings for both prompts. Holdout sites (4 train sites with smallest sha256(site)): "
             f"{', '.join(sites)}. n = {len(cases)} cases (smallest sha256(case id) among those sites' cases; test set never touched).", "",
             "| | plain prompt | geo prompt |", "|---|---|---|",
             f"| overall accuracy | {acc(plain):.1f}% | {acc(geo):.1f}% |",
             f"| replies truncated at max_tokens (wrong) | {sum('length' in str(r['finish_reason']) for r in plain)} | {sum('length' in str(r['finish_reason']) for r in geo)} |",
             f"| cost (USD, measured tokens x list price) | {cost['open_base']:.3f} | {cost['open_base_geo']:.3f} |", "",
             "By command_type:", "", "| command_type | n | plain | geo |", "|---|---|---|---|"]
    for t in sorted(set(ct.values())):
        a = [r for r in plain if ct[r["id"]] == t]; b = [r for r in geo if ct[r["id"]] == t]
        lines.append(f"| {t} | {len(a)} | {acc(a):.1f}% | {acc(b):.1f}% |")
    lines += ["", "Rows: results/val_rows/open_base.jsonl, open_base_geo.jsonl (validation only, never in results/rows)."]
    (RESULTS / "geo_validation.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    asyncio.run(main())
