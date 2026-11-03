"""pnpm replay: a 12 to 15 s terminal replay of REAL saved cases. Read-only on the locked test set."""
import hashlib
import io
import json
import re

from glance_lab.common import DATASET, ROWS, RESULTS, read_jsonl
from glance_lab.replay import replay as rp

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


def run_replay():
    pauses: list[float] = []
    out = io.StringIO()
    rc = rp.main(["--fast", "--no-clear"], out=out, sleep=pauses.append)
    return rc, ANSI.sub("", out.getvalue()), out.getvalue(), pauses


def test_pause_budget_is_12_to_15_seconds():
    rc, _, _, pauses = run_replay()
    assert rc == 0
    assert 12.0 <= sum(pauses) <= 15.0, sum(pauses)


def test_summary_line_uses_real_accuracies_only():
    s = json.loads((RESULTS / "summary.json").read_text())
    _, text, _, _ = run_replay()
    for k in ("nearest", "open_base", "frontier"):
        assert f"{s['acc'][k]:.1f}%" in text
    assert s["frontier_name"] in text
    assert f"{s['n_test']} held-out cases" in text
    # no per-row cost or latency leaks into the video, and no percentage that is not in summary.json
    assert not re.search(r"\d+ ?ms\b", text)
    allowed = {f"{v:.1f}" for v in s["acc"].values()}
    for pct in re.findall(r"(\d+\.\d)%", text):
        assert pct in allowed, pct


def test_every_pick_matches_the_saved_rows_and_claims_hold():
    _, text, _, _ = run_replay()
    ids = [c["id"] for c in rp.CASES]
    cases = rp.load_cases(ids)
    rows = rp.load_rows(ids)
    assert len(ids) == 5
    nearest_wrong_model_right = 0
    all_fail = 0
    for spec in rp.CASES:
        c = cases[spec["id"]]
        els = {e["id"]: e for e in c["elements"]}
        assert spec["id"] in text and f'"{c["command"]}"' in text
        for s in rp.SYSTEMS:
            r = rows[s][c["id"]]
            if r["pred"] is not None:
                assert rp.clean(els[r["pred"]]["name"]) in text
        near = rows["nearest"][c["id"]]
        assert near["score"] == 0 or near["pred"] == c["answer"]
        if near["score"] == 0 and (rows["frontier"][c["id"]]["score"] or rows["open_base"][c["id"]]["score"]):
            nearest_wrong_model_right += 1
        if all(rows[s][c["id"]]["score"] == 0 for s in rp.SYSTEMS):
            all_fail += 1
    assert nearest_wrong_model_right >= 3
    assert all_fail >= 1 and "every system missed this one." in text


def test_all_fail_case_is_checked_against_every_rows_file():
    spec = next(c for c in rp.CASES if not c["right"])
    # only the three systems on screen are named in the claim, so only those rows files are checked
    rows = rp.load_rows([spec["id"]])
    assert all(rows[s][spec["id"]]["score"] == 0 for s in rp.SYSTEMS)


def test_missing_answer_prints_no_answer_instead_of_crashing():
    _, text, _, _ = run_replay()
    cut = [r for r in read_jsonl(ROWS / "open_base.jsonl") if r["id"] == "test-github.com-009"][0]
    assert cut["pred"] is None
    assert "(no answer" in text


def test_terminal_is_always_restored_and_style_is_white_gray():
    _, _, raw, _ = run_replay()
    assert raw.endswith("\033[0m\033[?25h\n")
    colors = set(re.findall(r"\x1b\[([0-9;]+)m", raw))
    assert colors <= {"40", "1;97", "37", "90", "0"}, colors


def test_stale_claim_aborts():
    ids = [c["id"] for c in rp.CASES]
    cases, rows = rp.load_cases(ids), rp.load_rows(ids)
    spec = dict(rp.CASES[0])
    spec["wrong"] = {"frontier"}  # frontier is actually right on this case
    try:
        rp.verify(spec, cases[spec["id"]], rows)
    except SystemExit as e:
        assert "expected wrong" in str(e)
    else:
        raise AssertionError("verify should have aborted")


def test_locked_test_set_is_unchanged():
    manifest = json.loads((DATASET / "manifest.json").read_text())
    before = hashlib.sha256((DATASET / "test.jsonl").read_bytes()).hexdigest()
    run_replay()
    after = hashlib.sha256((DATASET / "test.jsonl").read_bytes()).hexdigest()
    assert before == after == manifest["test_sha256"]
