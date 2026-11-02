import asyncio
import json
from pathlib import Path

from glance_lab.systems import geometry
from glance_lab.systems.llm import Completion
from glance_lab.systems.run import make_row, run_geometry, vote_row

FIX = Path(__file__).parent / "fixtures" / "cases_tiny.jsonl"


def el(i, x, y, w=100, h=50):
    return {"id": i, "role": "link", "name": f"e{i}", "box": {"x": x, "y": y, "w": w, "h": h}}


def case(gx, gy, elements, answer=0):
    return {"id": "c", "site": "s", "sigma": 100, "gaze": {"x": gx, "y": gy}, "elements": elements, "answer": answer}


def test_box_distance():
    b = {"x": 100, "y": 100, "w": 100, "h": 50}
    assert geometry.box_distance(150, 120, b) == 0          # inside
    assert geometry.box_distance(100, 100, b) == 0          # on the corner
    assert geometry.box_distance(50, 125, b) == 50          # left
    assert abs(geometry.box_distance(250, 200, b) - 50 * 2 ** 0.5) < 1e-9  # diagonal from the corner (200,150)
    assert abs(geometry.box_distance(203, 154, b) - 5) < 1e-9   # dx=3, dy=4


def test_raw_gaze_inside_none_and_innermost():
    big, small = el(0, 0, 0, 500, 500), el(1, 100, 100, 50, 50)
    assert geometry.raw_gaze(case(120, 120, [big, small])) == 1   # smallest containing box
    assert geometry.raw_gaze(case(300, 300, [big, small])) == 0
    assert geometry.raw_gaze(case(900, 900, [big, small])) is None  # none contains it


def test_nearest_and_ties():
    a, b = el(0, 0, 0), el(1, 300, 0)
    assert geometry.nearest(case(250, 25, [a, b])) == 1
    # equidistant (gaze midway between two same-size boxes): smaller id wins after area tie
    assert geometry.nearest(case(200, 25, [b, a])) == 0   # equidistant, equal area: smaller id
    # tie on distance, different area: smaller area wins
    small, large = el(5, 100, 0, 50, 50), el(2, 200, 0, 100, 100)
    assert geometry.nearest(case(175, 25, [large, small])) == 5
    # inside two boxes: distance 0 for both, smaller area wins
    big, sm = el(0, 0, 0, 500, 500), el(1, 100, 100, 50, 50)
    assert geometry.nearest(case(120, 120, [big, sm])) == 1


def test_top_k_keeps_original_order_and_size():
    els = [el(i, i * 120, 0) for i in range(10)]
    got = geometry.top_k(case(0, 25, els), 5)
    assert [e["id"] for e in got] == [0, 1, 2, 3, 4]
    assert len(geometry.top_k(case(0, 25, els[:3]), 5)) == 3


def test_geometry_rows_score_none_as_wrong():
    c = case(900, 900, [el(0, 0, 0)], answer=0)
    r = run_geometry("raw_gaze", c)
    assert r["pred"] is None and r["score"] == 0
    r = run_geometry("nearest", c)
    assert r["pred"] == 0 and r["score"] == 1


def test_fixture_runs_without_model():
    cases = [json.loads(l) for l in FIX.read_text().splitlines()]
    assert len(cases) == 30 and len({c["site"] for c in cases}) == 6
    rows = [run_geometry("nearest", c) for c in cases]
    assert all(set(r) >= {"id", "site", "system", "sigma", "answer", "pred", "score", "latency_ms", "cost_usd"} for r in rows)


def _c(text, cost=0.001, lat=100.0, err=None):
    return Completion(text, 10, 5, lat, cost, err)


def test_vote_majority_ties_and_failures():
    els = [el(0, 0, 0), el(1, 300, 0), el(2, 600, 0)]
    c = case(310, 25, els, answer=1)
    r = vote_row(c, "harness_vote", [_c('{"target": 1}'), _c('{"target": 1}'), _c('{"target": 0}'), _c('{"target": 2}'), _c("garbage")])
    assert r["pred"] == 1 and r["score"] == 1 and abs(r["cost_usd"] - 0.005) < 1e-12
    # 2-2 tie between 0 and 1: nearest to gaze (1) wins
    r = vote_row(c, "harness_vote", [_c('{"target": 0}'), _c('{"target": 0}'), _c('{"target": 1}'), _c('{"target": 1}'), _c("x")])
    assert r["pred"] == 1
    # everything fails -> wrong, not dropped
    r = vote_row(c, "harness_vote", [_c(None, err="boom") for _ in range(5)])
    assert r["pred"] is None and r["score"] == 0
    # latency = slowest parallel call
    r = vote_row(c, "harness_vote", [_c('{"target": 1}', lat=l) for l in (10, 20, 30, 40, 50)])
    assert r["latency_ms"] == 50


def test_make_row_unparsed_is_wrong():
    r = make_row(case(0, 0, []), "open_base", None, 5.0, 0.0, "nonsense")
    assert r["score"] == 0 and r["pred"] is None


def test_run_system_with_fake_client(tmp_path):
    from types import SimpleNamespace

    from glance_lab.systems.llm import open_spec
    from glance_lab.systems.run import run_system

    calls = []

    class Fake:
        class chat:
            class completions:
                @staticmethod
                async def create(**kw):
                    calls.append(kw)
                    msg = SimpleNamespace(content='{"target": 3}')
                    return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=SimpleNamespace(prompt_tokens=100, completion_tokens=10))

    cases = [json.loads(l) for l in FIX.read_text().splitlines()][:4]
    ctx = {"sem": asyncio.Semaphore(2), "cache_dir": tmp_path, "open_spec": open_spec(), "open_client": Fake, "frontier_spec": None}
    rows = asyncio.run(run_system("open_base", cases, ctx))
    assert [r["id"] for r in rows] == [c["id"] for c in cases]
    assert all(r["pred"] == 3 for r in rows) and all(abs(r["cost_usd"] - (100 * 0.15 + 10 * 0.5) / 1e6) < 1e-12 for r in rows)
    n = len(calls)
    asyncio.run(run_system("open_base", cases, ctx))      # second run: all cache hits
    assert len(calls) == n
    assert all(kw["temperature"] == 0.0 for kw in calls)


def test_unknown_open_model_price_is_null_not_a_guess():
    from glance_lab.systems.llm import cost_usd, open_spec
    assert cost_usd(open_spec("accounts/fireworks/models/some-new-model"), 100, 10) is None
    assert cost_usd(open_spec(), 1_000_000, 1_000_000) == 0.65


def test_transient_errors_are_retried_not_scored_wrong(tmp_path):
    from types import SimpleNamespace

    from glance_lab.systems.llm import open_spec
    from glance_lab.systems.run import run_system

    class RateLimitError(Exception):
        status_code = 429

    state = {"n": 0}

    class Flaky:
        class chat:
            class completions:
                @staticmethod
                async def create(**kw):
                    state["n"] += 1
                    if state["n"] <= 3:
                        raise RateLimitError("429")
                    msg = SimpleNamespace(content='{"target": 3}')
                    return SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason="stop")],
                                           usage=SimpleNamespace(prompt_tokens=10, completion_tokens=2))

    import glance_lab.systems.llm as llm
    llm.BACKOFF_SCALE = 0.0
    cases = [json.loads(l) for l in FIX.read_text().splitlines()][:1]
    ctx = {"sem": asyncio.Semaphore(1), "cache_dir": tmp_path, "open_spec": open_spec(), "open_client": Flaky, "frontier_spec": None,
           "suffix": "_x"}
    rows = asyncio.run(run_system("open_base", cases, ctx, passes=0))
    # fast path: in-call backoff retried the 429s and the answer came back
    assert rows[0]["pred"] == 3 and rows[0]["retries"] == 3 and rows[0]["system"] == "open_base_x"
