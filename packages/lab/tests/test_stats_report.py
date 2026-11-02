import json
from pathlib import Path

import numpy as np

from glance_lab.stats.report import (build_summary, cluster_bootstrap, make_charts, mcnemar_exact, paired, verdict)


def test_mcnemar_known_cases():
    a = np.array([1] * 9 + [0] * 1 + [1] * 5)
    b = np.array([0] * 9 + [1] * 1 + [1] * 5)
    oa, ob, p = mcnemar_exact(a, b)
    assert (oa, ob) == (9, 1)
    assert abs(p - 0.021484375) < 1e-9      # 2 * P(X<=1 | n=10, .5) = 2*11/1024
    oa, ob, p = mcnemar_exact(np.array([1, 0, 1]), np.array([1, 0, 1]))
    assert (oa, ob, p) == (0, 0, 1.0)       # no discordant pairs
    oa, ob, p = mcnemar_exact(np.array([1, 1, 0, 0]), np.array([0, 0, 1, 1]))
    assert (oa, ob) == (2, 2) and p == 1.0


def test_cluster_bootstrap_known():
    # every site has a +1 gain: diff is 1 in every resample -> point and CI are exactly 100
    sites = ["a", "a", "b", "b", "c", "c"]
    d, (lo, hi) = cluster_bootstrap(sites, np.ones(6), n_boot=500)
    assert d == 100.0 and lo == 100.0 and hi == 100.0
    # zero diff everywhere
    d, (lo, hi) = cluster_bootstrap(sites, np.zeros(6), n_boot=500)
    assert (d, lo, hi) == (0.0, 0.0, 0.0)


def test_cluster_bootstrap_resamples_sites_and_is_deterministic():
    # site a: +1 (3 cases), site b: -1 (3 cases): mean 0 but CI must be wide because only 2 clusters
    sites = ["a"] * 3 + ["b"] * 3
    diff = np.array([1, 1, 1, -1, -1, -1], dtype=float)
    d1, ci1 = cluster_bootstrap(sites, diff, n_boot=2000)
    d2, ci2 = cluster_bootstrap(sites, diff, n_boot=2000)
    assert d1 == 0 and ci1 == ci2
    assert ci1 == (-100.0, 100.0)           # resamples can be all-a or all-b
    # case-level bootstrap would give a much narrower interval: confirm clustering matters
    assert ci1[1] - ci1[0] == 200.0


def test_verdict_requires_both_tests():
    assert "real" in verdict("x", "y", 5, 0.01, (1, 9)) and "x better" in verdict("x", "y", 5, 0.01, (1, 9))
    assert "y better" in verdict("x", "y", -5, 0.01, (-9, -1))
    assert "disagree" in verdict("x", "y", 5, 0.01, (-1, 9))
    assert "disagree" in verdict("x", "y", 5, 0.2, (1, 9))
    assert verdict("x", "y", 1, 0.5, (-3, 4)) == "no reliable difference"


def _rows(system, cases, scores):
    return {c["id"]: {"id": c["id"], "site": c["site"], "system": system, "sigma": c["sigma"], "answer": c["answer"],
                      "pred": c["answer"] if s else None, "score": s, "latency_ms": 100.0, "cost_usd": 0.001, "raw": None}
            for c, s in zip(cases, scores)}


def test_summary_shape_and_charts(tmp_path):
    cases = [{"id": f"c{i}", "site": f"s{i % 4}", "sigma": [60, 120][i % 2], "command_type": ["deictic", "role"][i % 2],
              "answer": 0} for i in range(40)]
    rng = np.random.default_rng(0)
    rows = {"nearest": _rows("nearest", cases, [1 if i % 3 else 0 for i in range(40)]),
            "open_base": _rows("open_base", cases, [1 if i % 2 else 0 for i in range(40)]),
            "open_cmd_only": _rows("open_cmd_only", cases, [0] * 40),
            "lora": _rows("lora", cases, [1] * 40)}
    s = build_summary(rows, cases, "gpt-test")
    assert set(s) >= {"frontier_name", "n_test", "n_sites", "acc", "cost_per_1k", "latency_p50_ms", "latency_note", "pairs",
                      "by_sigma", "by_command_type", "headline"}
    assert set(s["acc"]) == {"raw", "nearest", "open_base", "frontier", "lora"}
    assert s["acc"]["raw"] is None and s["acc"]["frontier"] is None and s["acc"]["lora"] == 100.0
    assert s["n_test"] == 40 and s["n_sites"] == 4 and s["frontier_name"] == "gpt-test"
    p = s["pairs"]["lora_vs_open_base"]
    assert p["n_only_a"] == 20 and p["n_only_b"] == 0 and p["mcnemar_p"] < 1e-5
    assert set(p) >= {"n_only_a", "n_only_b", "mcnemar_p", "boot_diff_pts", "boot_ci95"}
    assert "lora_vs_frontier" not in s["pairs"]
    assert s["by_sigma"]["60"]["lora"]["acc"] == 100.0 and "deictic" in s["by_command_type"]
    assert "gpt-test" in s["headline"] and "The LoRA beat the open base model (100.0% vs 50.0%" in s["headline"]
    assert s["not_run"] == ["raw", "frontier", "harness_top5", "harness_vote", "open_base_geo", "frontier_geo", "open_base_flash"]
    json.dumps(s)
    make_charts(s, tmp_path)
    for n in ("leaderboard.png", "disagreements.png", "bootstrap_ci.png"):
        assert (tmp_path / n).stat().st_size > 5000


def test_partial_system_is_paired_on_common_cases_and_flagged():
    cases = [{"id": f"c{i}", "site": f"s{i % 4}", "sigma": 60, "command_type": "role", "answer": 0} for i in range(40)]
    full = _rows("open_base", cases, [1, 0] * 20)
    part = _rows("lora", cases[:20], [1] * 20)
    s = build_summary({"open_base": full, "lora": part}, cases, "x")
    p = s["pairs"]["lora_vs_open_base"]
    assert p["n"] == 20 and p["acc_a"] == 100.0 and p["acc_b"] == 50.0
    assert s["systems"]["lora"]["complete"] is False
    assert "on 20 of 40 cases only" in s["headline"]
