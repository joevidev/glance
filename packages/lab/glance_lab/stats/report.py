"""Statistics, summary.json and charts for the Glance benchmark.

    python -m glance_lab.stats.report [--rows-dir DIR] [--cases FILE] [--out-dir DIR]

Paired comparison on the SAME cases, two tests that must agree before a gain is called real:
  * McNemar exact test on the discordant counts (scipy.stats.binomtest, two-sided)
  * cluster bootstrap that resamples whole SITES (5000 resamples, fixed seed) of the paired
    accuracy difference, 95% percentile interval.
The McNemar + cluster-bootstrap approach follows the organizers' reference report
(sinanuozdemir/ai-experiments, fp_report.py); this is an independent reimplementation.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import binomtest

from ..common import DATASET, RESULTS, ROWS, read_jsonl

N_BOOT = 5000
SEED = 20261102

# summary key -> row system name
CORE = {"raw": "raw_gaze", "nearest": "nearest", "open_base": "open_base", "frontier": "frontier", "lora": "lora"}
EXTRA = {"open_cmd_only": "open_cmd_only", "harness_top5": "harness_top5", "harness_vote": "harness_vote",
         "open_base_geo": "open_base_geo", "frontier_geo": "frontier_geo", "open_base_flash": "open_base_flash",
         # added 15:3x PT with the OpenAI key only (Fireworks was suspended): a repeat of the frontier run (run-to-run noise floor,
         # because the API forces temperature 1) and three more OpenAI models on the same locked cases and the same prompt
         "frontier_rerun": "frontier_rerun", "frontier_sol": "frontier_sol", "frontier_g54": "frontier_g54",
         "frontier_g54mini": "frontier_g54mini"}
LABELS = {"raw": "raw gaze", "nearest": "nearest to gaze", "open_base": "open model (gaze+command)",
          "frontier": "frontier", "lora": "open model + LoRA", "open_cmd_only": "open model (command only)",
          "harness_top5": "harness: top-5 nearest", "harness_vote": "harness: 5-vote",
          "open_base_geo": "open model + geo prompt", "frontier_geo": "frontier + geo prompt",
          "open_base_flash": "open model flash base (extra, not compared)",
          "frontier_rerun": "gpt-6-astra, second run (noise floor)", "frontier_sol": "gpt-6.1-sol",
          "frontier_g54": "gpt-5.4", "frontier_g54mini": "gpt-5.4-mini"}
PAIRS = [("lora", "open_base"), ("lora", "frontier"), ("lora", "nearest"), ("open_base", "nearest"),
         ("open_base", "open_cmd_only"), ("frontier", "nearest"),
         ("open_base_geo", "open_base"), ("frontier_geo", "frontier"), ("open_base_geo", "nearest"),
         ("open_base_flash", "frontier"), ("open_base", "frontier"), ("lora", "open_base_flash"),
         ("frontier_rerun", "frontier"), ("frontier_sol", "frontier"), ("frontier_g54", "frontier"),
         ("frontier_g54mini", "frontier"), ("open_base_flash", "frontier_g54mini"), ("open_base_flash", "frontier_sol"),
         ("lora", "frontier_g54mini")]


# ---------------------------------------------------------------- tests

def mcnemar_exact(a: np.ndarray, b: np.ndarray) -> tuple[int, int, float]:
    """a, b: 0/1 score arrays on the same cases. Returns (n_only_a, n_only_b, two-sided exact p)."""
    a = np.asarray(a); b = np.asarray(b)
    only_a = int(np.sum((a == 1) & (b == 0)))
    only_b = int(np.sum((a == 0) & (b == 1)))
    n = only_a + only_b
    if n == 0:
        return only_a, only_b, 1.0
    return only_a, only_b, float(binomtest(only_a, n, 0.5, alternative="two-sided").pvalue)


def _site_sums(sites: list[str], diff: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    idx: dict[str, int] = {}
    for s in sites:
        idx.setdefault(s, len(idx))
    sums = np.zeros(len(idx)); cnt = np.zeros(len(idx))
    for s, d in zip(sites, diff):
        sums[idx[s]] += d; cnt[idx[s]] += 1
    return sums, cnt


def cluster_bootstrap(sites: list[str], diff: np.ndarray, n_boot: int = N_BOOT, seed: int = SEED):
    """Resample whole sites with replacement. diff = per-case score_a - score_b.
    Returns (observed mean diff in points, (lo, hi) 95% percentile CI in points)."""
    diff = np.asarray(diff, dtype=float)
    sums, cnt = _site_sums(sites, diff)
    rng = np.random.default_rng(seed)
    k = len(sums)
    pick = rng.integers(0, k, size=(n_boot, k))
    boot = sums[pick].sum(1) / cnt[pick].sum(1) * 100
    lo, hi = np.percentile(boot, [2.5, 97.5])
    return float(diff.mean() * 100), (float(lo), float(hi))


def bootstrap_acc_ci(sites: list[str], score: np.ndarray, n_boot: int = N_BOOT, seed: int = SEED):
    sums, cnt = _site_sums(sites, np.asarray(score, dtype=float))
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, len(sums), size=(n_boot, len(sums)))
    boot = sums[pick].sum(1) / cnt[pick].sum(1) * 100
    lo, hi = np.percentile(boot, [2.5, 97.5])
    return float(lo), float(hi)


def verdict(a: str, b: str, diff_pts: float, p: float, ci: tuple[float, float]) -> str:
    sig_p = p < 0.05
    sig_ci = ci[0] > 0 or ci[1] < 0
    if sig_p and sig_ci and diff_pts != 0:
        return f"{a} better (real: McNemar and cluster bootstrap agree)" if diff_pts > 0 else f"{b} better (real: McNemar and cluster bootstrap agree)"
    if sig_p != sig_ci:
        return "tests disagree: not called real"
    return "no reliable difference"


# ---------------------------------------------------------------- data

def load_rows(rows_dir: Path) -> dict[str, dict[str, dict]]:
    out: dict[str, dict[str, dict]] = {}
    for p in sorted(rows_dir.glob("*.jsonl")):
        rows = read_jsonl(p)
        out[p.stem] = {r["id"]: r for r in rows}
    return out


def pct(x: float) -> float:
    return round(x, 2)


def percentile(vals: list[float], q: float) -> float | None:
    return None if not vals else float(np.percentile(vals, q))


def system_stats(rows: dict[str, dict], n_test: int) -> dict:
    rs = list(rows.values())
    n = len(rs)
    lat = [r["latency_ms"] for r in rs if r.get("latency_ms") is not None]
    costs = [r["cost_usd"] for r in rs]
    cost_known = n > 0 and all(c is not None for c in costs)
    return {
        "n": n, "complete": n == n_test,
        "acc": pct(sum(r["score"] for r in rs) / n * 100) if n else None,
        "cost_per_1k": round(sum(costs) / n * 1000, 4) if cost_known else None,
        "latency_p50_ms": round(percentile(lat, 50), 1) if lat else None,
        "latency_p95_ms": round(percentile(lat, 95), 1) if lat else None,
        "n_pred_none": sum(1 for r in rs if r["pred"] is None),
        "n_truncated_length": sum(1 for r in rs if "length" in str(r.get("finish_reason"))),
        "n_pred_wrong_id": sum(1 for r in rs if r["pred"] is not None and not r["score"]),
        "n_rows_retried": sum(1 for r in rs if r.get("retries")),
        "n_api_error": sum(1 for r in rs if str(r.get("raw") or "").startswith("ERROR")),
    }


def breakdown(rows_by_sys: dict[str, dict[str, dict]], key_of, keys_order=None) -> dict:
    out: dict = {}
    for name, rows in rows_by_sys.items():
        groups: dict = defaultdict(list)
        for r in rows.values():
            groups[key_of(r)].append(r["score"])
        for k, v in groups.items():
            out.setdefault(str(k), {})[name] = {"acc": pct(sum(v) / len(v) * 100), "n": len(v)}
    keys = sorted(out, key=lambda s: (float(s) if s.replace(".", "", 1).isdigit() else s))
    return {k: out[k] for k in keys}


def paired(rows_by_sys, a: str, b: str, site_of: dict[str, str]) -> dict | None:
    if a not in rows_by_sys or b not in rows_by_sys:
        return None
    ids = sorted(set(rows_by_sys[a]) & set(rows_by_sys[b]))
    if not ids:
        return None
    sa = np.array([rows_by_sys[a][i]["score"] for i in ids])
    sb = np.array([rows_by_sys[b][i]["score"] for i in ids])
    sites = [site_of[i] for i in ids]
    oa, ob, p = mcnemar_exact(sa, sb)
    diff, ci = cluster_bootstrap(sites, sa - sb)
    return {"a": a, "b": b, "n": len(ids), "n_sites": len(set(sites)), "n_only_a": oa, "n_only_b": ob,
            "acc_a": round(float(sa.mean() * 100), 2), "acc_b": round(float(sb.mean() * 100), 2),
            "mcnemar_p": p, "boot_diff_pts": round(diff, 3), "boot_ci95": [round(ci[0], 3), round(ci[1], 3)],
            "verdict": verdict(a, b, diff, p, ci)}


def make_headline(s: dict) -> str:
    acc = s["acc"]
    n, ns = s["n_test"], s["n_sites"]
    sy = s["systems"]
    parts = []

    def f(k):
        return "n/a" if acc.get(k) is None else f"{acc[k]:.1f}%"

    lp = s["pairs"].get("lora_vs_open_base")
    if lp:
        la, ba = lp["acc_a"], lp["acc_b"]
        if la > ba:
            verb = "beat"
        elif la < ba:
            verb = "did not beat"
        else:
            verb = "tied"
        lo, hi = lp["boot_ci95"]
        parts.append(f"The LoRA {verb} the open base model ({la:.1f}% vs {ba:.1f}%, discordant pairs {lp['n_only_a']} vs {lp['n_only_b']}, "
                     f"McNemar p={lp['mcnemar_p']:.3g}, 95% site-bootstrap CI {lo:+.1f} to {hi:+.1f} points: {lp['verdict']}).")
        nl, nb = sy["lora"]["n_pred_none"], sy["open_base"]["n_pred_none"]
        if nl < nb:
            parts.append(f"It removed the format errors: {nl} unparseable replies vs {nb} for the base model.")
        elif nl > nb:
            parts.append(f"It produced more unparseable replies than the base model ({nl} vs {nb}).")
    parts.append(f"On {n} held-out test commands from {ns} sites: nearest-to-gaze {f('nearest')}, raw gaze {f('raw')}, "
                 f"open model with gaze {f('open_base')}, {s['frontier_name'] or 'frontier'} {f('frontier')}, open model + LoRA {f('lora')}"
                 f"{'' if sy.get('lora', {}).get('n') in (None, n) else ' (on ' + str(sy['lora']['n']) + ' of ' + str(n) + ' cases only)'}.")
    for pair, label in (("lora_vs_frontier", "LoRA vs frontier"), ("lora_vs_nearest", "LoRA vs nearest"),
                        ("open_base_vs_open_cmd_only", "gaze+command vs command only (open model)"),
                        ("open_base_geo_vs_open_base", "open model + geo prompt vs plain prompt"),
                        ("frontier_geo_vs_frontier", "frontier + geo prompt vs plain prompt")):
        p = s["pairs"].get(pair)
        if p:
            lo, hi = p["boot_ci95"]
            same = "" if p["n"] == n else f" [paired on the {p['n']} common cases]"
            parts.append(f"{label}{same}: {p['boot_diff_pts']:+.1f} points (95% site-bootstrap CI {lo:+.1f} to {hi:+.1f}, "
                         f"McNemar p={p['mcnemar_p']:.3g}, {p['n_only_a']} vs {p['n_only_b']} discordant), {p['verdict']}.")
    # accuracy vs cost vs latency of the open models against the frontier model (numbers only, no latency claim unless it holds)
    c, l, a = s["cost_per_1k"], s["latency_p50_ms"], s["acc"]
    for key, label in (("open_base_flash", "untrained flash base (glm-5p3-flash, NOT the LoRA's base)"), ("open_base", "open base model (glm-5p3)"), ("lora", "LoRA (glm-5p3)")):
        acc_k = a.get(key) if key in a else s["extra"].get(key, {}).get("acc")
        if acc_k is None or a.get("frontier") is None or c.get(key) is None or c.get("frontier") is None:
            continue
        lat = ""
        if l.get(key) is not None and l.get("frontier") is not None:
            lat = (f"; median latency {l[key] / 1000:.1f}s vs {l['frontier'] / 1000:.1f}s, "
                   + ("about the same as" if abs(l[key] - l["frontier"]) < 0.05 * l["frontier"] else "faster than" if l[key] < l["frontier"] else "slower than")
                   + " the frontier model")
        parts.append(f"{label}: {acc_k:.1f}% at ${c[key]:.2f} per 1,000 commands vs {s['frontier_name'] or 'frontier'} {a['frontier']:.1f}% at "
                     f"${c['frontier']:.2f}{lat}" + (" (LoRA latency was sampled inside a training session, not serving)" if key == "lora" else "") + ".")
    if s["not_run"]:
        parts.append("Not run or incomplete: " + ", ".join(s["not_run"]) + ".")
    return " ".join(parts)


def build_summary(rows_by_sys: dict[str, dict[str, dict]], cases: list[dict], frontier_name: str | None) -> dict:
    n_test = len(cases)
    site_of = {c["id"]: c["site"] for c in cases}
    ctype = {c["id"]: c["command_type"] for c in cases}
    for name, rows in rows_by_sys.items():
        for i in rows:
            if i not in site_of:
                raise SystemExit(f"row id {i} of system {name} is not in the test cases")
    sys_stats = {name: system_stats(rows, n_test) for name, rows in rows_by_sys.items()}
    all_keys = {**CORE, **EXTRA}

    def get(key, field):
        st = sys_stats.get(all_keys[key])
        return st[field] if st else None

    pairs = {}
    for a, b in PAIRS:
        pr = paired(rows_by_sys, all_keys[a], all_keys[b], site_of)
        if pr:
            pairs[f"{a}_vs_{b}"] = pr
    ci = {}
    for key, name in all_keys.items():
        if name in rows_by_sys:
            ids = sorted(rows_by_sys[name])
            lo, hi = bootstrap_acc_ci([site_of[i] for i in ids], np.array([rows_by_sys[name][i]["score"] for i in ids]))
            ci[key] = [round(lo, 2), round(hi, 2)]
    summary = {
        "frontier_name": frontier_name,
        "n_test": n_test,
        "n_sites": len(set(site_of.values())),
        "acc": {k: get(k, "acc") for k in CORE},
        "acc_ci95_site_bootstrap": ci,
        "cost_per_1k": {k: get(k, "cost_per_1k") for k in all_keys},
        "latency_p50_ms": {k: get(k, "latency_p50_ms") for k in all_keys},
        "latency_p95_ms": {k: get(k, "latency_p95_ms") for k in all_keys},
        "latency_note": ("LLM latency is wall time of one API call (successful attempt, excluding retry backoff and queueing) "
                         "measured with up to 16 requests in flight; harness_vote is the slowest of its 5 parallel calls. "
                         "The open model is a thinking-only model, so its latency includes the reasoning trace. "
                         "Geometry baselines are computed locally (reported as 0 ms). "
                         "The LoRA latency, when present, was sampled inside a training session and is NOT serving latency."),
        "systems": sys_stats,
        "not_run": [k for k, name in all_keys.items() if name not in rows_by_sys],
        "pairs": pairs,
        "by_sigma": breakdown(rows_by_sys, lambda r: r["sigma"]),
        "by_command_type": breakdown({n: {i: dict(r, _ct=ctype[i]) for i, r in rows.items()} for n, rows in rows_by_sys.items()},
                                     lambda r: r["_ct"]),
        "extra": {k: {"acc": get(k, "acc"), "cost_per_1k": get(k, "cost_per_1k"), "latency_p50_ms": get(k, "latency_p50_ms")}
                  for k in EXTRA},
        "method": {"mcnemar": "exact, scipy.stats.binomtest two-sided on discordant pairs",
                   "bootstrap": f"{N_BOOT} resamples of whole sites, seed {SEED}, paired accuracy difference (a minus b), 95% percentile interval",
                   "real_gain_rule": "p < 0.05 AND the 95% CI excludes 0 (both must agree)"},
    }
    summary["headline"] = make_headline(summary)
    return summary


# ---------------------------------------------------------------- charts

BG, FG, GRAY, DIM = "#000000", "#ffffff", "#9a9a9a", "#4a4a4a"


def _style(ax):
    ax.set_facecolor(BG)
    for s in ax.spines.values():
        s.set_color(DIM)
    ax.tick_params(colors=FG)
    ax.xaxis.label.set_color(FG); ax.yaxis.label.set_color(FG); ax.title.set_color(FG)


def make_charts(summary: dict, out_dir: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    n = summary["n_test"]
    # leaderboard
    items = [(k, v) for k, v in summary["acc"].items() if v is not None]
    for k, v in summary["extra"].items():
        if v["acc"] is not None:
            items.append((k, v["acc"]))
    items.sort(key=lambda kv: kv[1])
    fig, ax = plt.subplots(figsize=(9, 0.55 * len(items) + 1.6), facecolor=BG)
    _style(ax)
    ci = summary["acc_ci95_site_bootstrap"]
    ys = range(len(items))
    for y, (k, v) in zip(ys, items):
        top = k in ("lora",)
        ax.barh(y, v, color=FG if top else GRAY, height=0.6)
        if k in ci:
            ax.errorbar(v, y, xerr=[[v - ci[k][0]], [ci[k][1] - v]], color=FG if not top else "#000000", capsize=3, lw=1)
        ax.text(min(v + 1, 97) if k not in ci else ci[k][1] + 1, y, f"{v:.1f}%", va="center", color=FG, fontsize=10)
    def lab(k):
        base = LABELS[k] if k != "frontier" else (summary["frontier_name"] or "frontier")
        nk = summary["systems"].get(CORE.get(k) or EXTRA.get(k), {}).get("n")
        return base if nk in (None, n) else f"{base} (n={nk})"
    ax.set_yticks(list(ys)); ax.set_yticklabels([lab(k) for k, _ in items])
    ax.set_xlim(0, 108); ax.set_xlabel("accuracy on held-out test commands (%)  |  whiskers: 95% CI, resampling sites")
    ax.set_title(f"Glance leaderboard, n={n} commands, {summary['n_sites']} sites", loc="left")
    ax.grid(axis="x", color=DIM, lw=0.4)
    fig.tight_layout(); fig.savefig(out_dir / "leaderboard.png", dpi=160, facecolor=BG); plt.close(fig)

    pairs = summary["pairs"]
    if not pairs:
        return
    names = list(pairs)
    # disagreements
    fig, ax = plt.subplots(figsize=(9, 0.7 * len(names) + 1.8), facecolor=BG)
    _style(ax)
    for y, nm in enumerate(names):
        p = pairs[nm]
        ax.barh(y, -p["n_only_a"], color=FG, height=0.55)
        ax.barh(y, p["n_only_b"], color=GRAY, height=0.55)
        ax.text(-p["n_only_a"] - 1, y, str(p["n_only_a"]), ha="right", va="center", color=FG)
        ax.text(p["n_only_b"] + 1, y, str(p["n_only_b"]), ha="left", va="center", color=FG)
    ax.axvline(0, color=FG, lw=0.8)
    ax.set_yticks(range(len(names))); ax.set_yticklabels([nm.replace("_vs_", "  vs  ") for nm in names])
    ax.set_xlabel("cases where only the first system (left, white) / only the second (right, gray) is correct")
    ax.set_title("Disagreements on the same cases", loc="left")
    m = max(max(p["n_only_a"], p["n_only_b"]) for p in pairs.values()) * 1.25 + 2
    from matplotlib.ticker import FuncFormatter, MaxNLocator
    ax.set_xlim(-m, m); ax.xaxis.set_major_locator(MaxNLocator(integer=True)); ax.xaxis.set_major_formatter(FuncFormatter(lambda t, _: str(abs(int(t)))))
    ax.invert_yaxis()
    fig.tight_layout(); fig.savefig(out_dir / "disagreements.png", dpi=160, facecolor=BG); plt.close(fig)

    # bootstrap ci
    fig, ax = plt.subplots(figsize=(9, 0.7 * len(names) + 1.8), facecolor=BG)
    _style(ax)
    for y, nm in enumerate(names):
        p = pairs[nm]; lo, hi = p["boot_ci95"]
        real = "real" in p["verdict"] and "no reliable" not in p["verdict"] and "not called" not in p["verdict"]
        ax.plot([lo, hi], [y, y], color=FG if real else GRAY, lw=2.5)
        ax.plot([p["boot_diff_pts"]], [y], "o", color=FG if real else GRAY, ms=7)
        ax.text(hi + 0.4, y, f"{p['boot_diff_pts']:+.1f}  p={p['mcnemar_p']:.2g}", va="center", color=FG, fontsize=9)
    ax.axvline(0, color=FG, lw=0.8, ls="--")
    ax.set_yticks(range(len(names))); ax.set_yticklabels([nm.replace("_vs_", "  minus  ") for nm in names])
    ax.set_xlabel("paired accuracy difference, points (95% site-bootstrap CI)")
    ax.set_title("Is the gain real?  white = McNemar and bootstrap agree", loc="left")
    ax.invert_yaxis(); ax.grid(axis="x", color=DIM, lw=0.4)
    xl = ax.get_xlim(); ax.set_xlim(xl[0], xl[1] + (xl[1] - xl[0]) * 0.25)
    fig.tight_layout(); fig.savefig(out_dir / "bootstrap_ci.png", dpi=160, facecolor=BG); plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows-dir", default=str(ROWS))
    ap.add_argument("--cases", default=str(DATASET / "test.jsonl"))
    ap.add_argument("--out-dir", default=str(RESULTS))
    ap.add_argument("--frontier-name", default=None, help="exact model id; default read from results/frontier_name.txt")
    a = ap.parse_args()
    out = Path(a.out_dir)
    cases = read_jsonl(Path(a.cases))
    fn = a.frontier_name
    fp = RESULTS / "frontier_name.txt"
    if fn is None and fp.exists():
        fn = fp.read_text().strip()
    rows = load_rows(Path(a.rows_dir))
    if not rows:
        raise SystemExit(f"no rows in {a.rows_dir}")
    summary = build_summary(rows, cases, fn)
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    make_charts(summary, out / "charts")
    print(summary["headline"])
    print(f"wrote {out/'summary.json'} and charts in {out/'charts'}")


if __name__ == "__main__":
    main()
