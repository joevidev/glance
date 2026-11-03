"""Terminal replay of REAL benchmark cases, for the demo video (beat 3b).  Run: pnpm replay

Reads only saved data, read-only:
  data/dataset/test.jsonl         the locked test set (never written)
  results/rows/<system>.jsonl     what each system answered, one row per case
  results/summary.json            the accuracies printed on the last screen

Nothing is invented and no model is called. Five cases are chosen BY ID and are checked against the
rows when the script starts; if the data ever stops matching what a case is supposed to show, the
script stops with an error instead of printing a stale claim.

Look: white and gray on black (ANSI). `--fast` removes the pauses (tests); `--no-clear` keeps the scrollback.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Callable, TextIO

from glance_lab.common import DATASET, RESULTS, ROWS, read_jsonl
from glance_lab.systems.geometry import box_distance, ranked_by_distance

# --- the five cases (ids in data/dataset/test.jsonl) and what each must show -------------------------
# nearest_wrong: the nearest-to-gaze element is not the answer.  right / wrong: systems that must
# have it right / wrong.  A mismatch with the saved rows aborts the replay.
SYSTEMS = ("nearest", "frontier", "open_base")
CASES = [
    {"id": "test-huggingface.co-027", "right": {"frontier", "open_base"}, "wrong": {"nearest"}},
    {"id": "test-linear.app-024", "right": {"frontier", "open_base"}, "wrong": {"nearest"}},
    {"id": "test-github.com-009", "right": {"frontier"}, "wrong": {"nearest", "open_base"}},
    {"id": "test-w3schools.com-007", "right": {"frontier"}, "wrong": {"nearest", "open_base"}},
    {"id": "test-github.com-041", "right": set(), "wrong": {"nearest", "frontier", "open_base"}},  # all fail
]
OPEN_NAME = "glm-5p3"  # the open model behind the `open_base` rows (see summary.json headline)

# --- ANSI: white and gray on black --------------------------------------------------------------------
BLACK_BG = "\033[40m"
WHITE = "\033[1;97m"
GRAY = "\033[37m"
DIM = "\033[90m"
RESET = "\033[0m"
CLEAR = "\033[2J\033[H"
HIDE, SHOW = "\033[?25l", "\033[?25h"

# Pause budget (seconds), kept here so the test can check the whole replay is 12 to 15 s.
P_INTRO, P_HEAD, P_CMD, P_GAZE, P_NEAR_LINE = 0.6, 0.2, 0.2, 0.2, 0.1
P_PICK, P_HOLD, P_SUMMARY = 0.3, 0.2, 1.8
CHAR_DELAY = 0.0  # no per-character typing: it would only add time


def clean(name: str, width: int = 26) -> str:
    """Keep the terminal look: drop emoji and exotic glyphs, trim, add '...' if cut."""
    s = "".join(ch for ch in name if ch.isprintable() and ord(ch) < 0x2000).strip()
    s = " ".join(s.split())
    return s if len(s) <= width else s[: width - 3] + "..."


def load_cases(ids: list[str]) -> dict[str, dict]:
    want = set(ids)
    out = {}
    with (DATASET / "test.jsonl").open() as f:  # read only
        for line in f:
            if not line.strip():
                continue
            c = json.loads(line)
            if c["id"] in want:
                out[c["id"]] = c
    missing = want - set(out)
    if missing:
        raise SystemExit(f"replay: cases not found in test.jsonl: {sorted(missing)}")
    return out


def load_rows(ids: list[str]) -> dict[str, dict[str, dict]]:
    want = set(ids)
    rows: dict[str, dict[str, dict]] = {}
    for s in SYSTEMS:
        rows[s] = {r["id"]: r for r in read_jsonl(ROWS / f"{s}.jsonl") if r["id"] in want}
        miss = want - set(rows[s])
        if miss:
            raise SystemExit(f"replay: no {s} row for {sorted(miss)}")
    return rows


def load_summary() -> dict:
    return json.loads((RESULTS / "summary.json").read_text())


def verify(spec: dict, case: dict, rows: dict[str, dict[str, dict]]) -> None:
    """Abort if the saved rows no longer show what this case is chosen to show."""
    for s in SYSTEMS:
        r = rows[s][case["id"]]
        if r["answer"] != case["answer"]:
            raise SystemExit(f"replay: {case['id']} {s} row answer differs from test.jsonl")
        if s == "nearest":
            ranked = ranked_by_distance(case)
            if r["pred"] != (ranked[0]["id"] if ranked else None):
                raise SystemExit(f"replay: {case['id']} nearest row differs from the geometry (nearest element)")
        right = r["pred"] is not None and r["pred"] == case["answer"]
        if bool(r["score"]) != right:
            raise SystemExit(f"replay: {case['id']} {s} row score disagrees with pred/answer")
        if s in spec["right"] and not right:
            raise SystemExit(f"replay: {case['id']}: {s} was expected right but the rows say wrong")
        if s in spec["wrong"] and right:
            raise SystemExit(f"replay: {case['id']}: {s} was expected wrong but the rows say right")


def build_view(spec: dict, case: dict, rows: dict) -> dict:
    """Everything one screen prints, taken from the case and the rows only."""
    g = case["gaze"]
    els = {e["id"]: e for e in case["elements"]}
    ranked = ranked_by_distance(case)
    near = [(e["id"], clean(e["name"]), box_distance(g["x"], g["y"], e["box"])) for e in ranked[:3]]
    ans = els[case["answer"]]
    picks = {}
    for s in SYSTEMS:
        r = rows[s][case["id"]]
        pred = r["pred"]
        e = els.get(pred) if pred is not None else None
        picks[s] = {
            "pred": pred,
            "name": clean(e["name"]) if e else None,
            "right": bool(r["score"]),
            "cut_off": r.get("finish_reason") == "length",
        }
    return {
        "id": case["id"], "site": case["site"], "command": case["command"], "gaze": (g["x"], g["y"]),
        "sigma": case["sigma"], "near": near, "answer_id": case["answer"], "answer_name": clean(ans["name"]),
        "answer_dist": box_distance(g["x"], g["y"], ans["box"]), "picks": picks,
        "nearest_id": ranked[0]["id"], "all_fail": not any(p["right"] for p in picks.values()),
    }


class Replay:
    def __init__(self, summary: dict, out: TextIO, sleep: Callable[[float], None], clear: bool = True):
        self.summary, self.out, self.sleep, self.clear = summary, out, sleep, clear
        self.frontier = summary["frontier_name"]

    # one write path so everything stays white/gray and flushes
    def w(self, text: str = "", style: str = GRAY, pause: float = 0.0) -> None:
        self.out.write(f"{BLACK_BG}{style}{text}{RESET}\n")
        self.out.flush()
        if pause:
            self.sleep(pause)

    def screen(self) -> None:
        if self.clear:
            self.out.write(BLACK_BG + CLEAR)
            self.out.flush()

    def pick_line(self, label: str, p: dict, view: dict) -> str:
        if p["pred"] is None or p["name"] is None:
            what = "(no answer: reply cut off)" if p["cut_off"] else "(no answer)"
        else:
            what = f"{p['name']}"
        mark = "✔ right" if p["right"] else "✖ wrong"
        return f"  {label:<24}{what:<30}{mark}"

    def case(self, i: int, n: int, v: dict) -> None:
        self.screen()
        self.w(f"case {i} of {n}   {v['site']}   {v['id']}", DIM, P_HEAD)
        self.w()
        self.w(f'  command     "{v["command"]}"', WHITE, P_CMD)
        self.w(f"  gaze        ({v['gaze'][0]:.0f}, {v['gaze'][1]:.0f})   simulated, noise sigma {v['sigma']} px", GRAY, P_GAZE)
        self.w("  nearest to the gaze:", DIM)
        for k, (eid, name, d) in enumerate(v["near"]):
            tag = "   <- nearest" if k == 0 else ""
            self.w(f"      {name:<28}{d:>5.0f} px{tag}", GRAY, P_NEAR_LINE)
        if v["answer_id"] not in [x[0] for x in v["near"]]:
            self.w(f"      {v['answer_name']:<28}{v['answer_dist']:>5.0f} px   <- the true answer", GRAY)
        self.w()
        self.w(self.pick_line("nearest element", v["picks"]["nearest"], v), WHITE if v["picks"]["nearest"]["right"] else GRAY, P_PICK)
        self.w(self.pick_line(f"frontier {self.frontier}", v["picks"]["frontier"], v), WHITE if v["picks"]["frontier"]["right"] else GRAY, P_PICK)
        self.w(self.pick_line(f"open {OPEN_NAME}", v["picks"]["open_base"], v), WHITE if v["picks"]["open_base"]["right"] else GRAY, P_PICK)
        self.w(f"  true answer             {v['answer_name']}", WHITE, P_PICK)
        if v["all_fail"]:
            self.w("  every system missed this one.", DIM)
        self.sleep(P_HOLD)

    def run(self, views: list[dict]) -> None:
        s = self.summary
        self.screen()
        self.w("Glance: replay of saved benchmark results", WHITE)
        self.w("held-out test cases, 8 sites never used in training. Saved rows, no live calls.", DIM)
        self.w("The gaze point is simulated at webcam error levels.", DIM, P_INTRO)
        for i, v in enumerate(views, 1):
            self.case(i, len(views), v)
        self.screen()
        acc = s["acc"]
        self.w("All %d held-out cases, %d sites (same cases, same prompt for every system)" % (s["n_test"], s["n_sites"]), WHITE)
        self.w()
        table = [
            ("nearest element to the gaze", acc["nearest"], GRAY),
            (f"open {OPEN_NAME}, gaze + command", acc["open_base"], GRAY),
            (f"frontier {self.frontier}, gaze + command", acc["frontier"], WHITE),
        ]
        width = max(len(t[0]) for t in table) + 2
        for label, value, style in table:
            self.w(f"  {label:<{width}}{value:>5.1f}%", style)
        self.w()
        self.w(f"The {len(views)} cases above were picked to illustrate; the percentages are over all {s['n_test']}.", DIM, P_SUMMARY)


def main(argv: list[str] | None = None, out: TextIO | None = None, sleep: Callable[[float], None] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Replay real benchmark cases in the terminal (video fallback, beat 3b).")
    ap.add_argument("--fast", action="store_true", help="no pauses (for tests)")
    ap.add_argument("--no-clear", action="store_true", help="do not clear the screen between cases")
    a = ap.parse_args(argv)
    out = out or sys.stdout
    sleep = sleep or (lambda s: None if a.fast else time.sleep(s))

    ids = [c["id"] for c in CASES]
    cases, rows, summary = load_cases(ids), load_rows(ids), load_summary()
    views = []
    for spec in CASES:
        verify(spec, cases[spec["id"]], rows)
        views.append(build_view(spec, cases[spec["id"]], rows))

    rp = Replay(summary, out, sleep, clear=not a.no_clear and out.isatty())
    out.write(HIDE)
    try:
        rp.run(views)
    except KeyboardInterrupt:
        pass
    finally:  # always give the terminal back, even on Ctrl-C
        out.write(RESET + SHOW + "\n")
        out.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
