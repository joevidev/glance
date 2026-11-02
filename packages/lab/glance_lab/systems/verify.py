"""Verify rows against the locked test set: exactly one row per case per system, ids equal, schema fields present.

    python -m glance_lab.systems.verify [--systems a,b]
"""
from __future__ import annotations

import argparse
import sys

from ..common import DATASET, ROWS, read_jsonl

REQ = ["id", "site", "system", "sigma", "answer", "pred", "score", "latency_ms", "cost_usd"]


def verify(systems: list[str] | None = None) -> bool:
    test = read_jsonl(DATASET / "test.jsonl")
    ids = [c["id"] for c in test]
    ok = True
    for p in sorted(ROWS.glob("*.jsonl")):
        if systems and p.stem not in systems:
            continue
        rows = read_jsonl(p)
        got = [r["id"] for r in rows]
        problems = []
        if len(got) != len(set(got)):
            problems.append("duplicate ids")
        if set(got) != set(ids):
            problems.append(f"id set differs: missing {len(set(ids) - set(got))}, extra {len(set(got) - set(ids))}")
        if any(r["system"] != p.stem for r in rows):
            problems.append("system field != file name")
        if any(k not in r for r in rows for k in REQ):
            problems.append("missing required field")
        ans = {c["id"]: c["answer"] for c in test}
        if any(r["answer"] != ans.get(r["id"]) for r in rows):
            problems.append("answer differs from test.jsonl")
        if any(r["score"] != int(r["pred"] is not None and r["pred"] == r["answer"]) for r in rows):
            problems.append("score inconsistent with pred/answer")
        print(f"{p.stem}: {len(rows)}/{len(ids)} rows {'OK' if not problems else 'PROBLEMS ' + '; '.join(problems)}")
        ok &= not problems
    return ok


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--systems", default="")
    a = ap.parse_args()
    sys.exit(0 if verify([s for s in a.systems.split(",") if s] or None) else 1)
