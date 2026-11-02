"""Offline tests for datum building (no network, no tokenizer download)."""
from __future__ import annotations

import json
import re

import pytest

from glance_lab.common import CONTRACTS
from glance_lab.prompt import GOLDEN_CASE, build_prompt, completion
from glance_lab.train import core
from glance_lab.train.run import check_disjoint, mean_loss


class FakeTok:
    """Deterministic stand-in: special tags are single ids, every other char is one id."""

    SPECIALS = {"[gMASK]": 1, "<sop>": 2, "<|user|>": 3, "<|assistant|>": 4, "</think>": 5, "<think>": 6, "<|system|>": 7}

    def encode(self, text, add_special_tokens=False):
        assert add_special_tokens is False
        out = []
        for part in re.split("(" + "|".join(map(re.escape, self.SPECIALS)) + ")", text):
            if part in self.SPECIALS:
                out.append(self.SPECIALS[part])
            else:
                out.extend(1000 + ord(ch) for ch in part)
        return out

    def decode(self, ids, skip_special_tokens=False):
        inv = {v: k for k, v in self.SPECIALS.items()}
        return "".join(inv.get(i) or chr(i - 1000) for i in ids)


TOK = FakeTok()


def test_context_matches_golden_prompt():
    fx = json.loads((CONTRACTS / "fixtures" / "prompt_golden.json").read_text())
    ctx = core.context_text(fx["case"])
    assert ctx == "[gMASK]<sop><|system|>Reasoning Effort: Max<|user|>" + fx["prompt_with_gaze"] + "<|assistant|><think>"
    assert build_prompt(GOLDEN_CASE) == fx["prompt_with_gaze"]


def test_example_masks_only_completion_and_stop():
    tokens, weights = core.build_example(TOK, GOLDEN_CASE)
    ctx = core.prompt_tokens(TOK, GOLDEN_CASE)
    assert tokens[: len(ctx)] == ctx
    assert weights[: len(ctx)] == [0.0] * len(ctx)
    tail = tokens[len(ctx):]
    assert TOK.decode(tail[:-1]) == "</think>" + completion(GOLDEN_CASE["answer"]) == '</think>{"target": 15}'
    assert tail[-1] == TOK.SPECIALS["<|user|>"]
    assert weights[len(ctx):] == [1.0] * len(tail)


def test_shift_is_next_token_layout():
    inp, tgt, w = core.shift([10, 11, 12, 13], [0.0, 0.0, 1.0, 1.0])
    assert inp == [10, 11, 12] and tgt == [11, 12, 13] and w == [0.0, 1.0, 1.0]
    assert len(inp) == len(tgt) == len(w)
    with pytest.raises(ValueError):
        core.shift([1, 2], [1.0])


def test_too_long_example_is_dropped_not_truncated():
    assert core.build_example(TOK, GOLDEN_CASE, max_seq_len=50) is None


def test_special_id_requires_single_token():
    assert core.special_id(TOK, "<|user|>") == 3
    with pytest.raises(ValueError):
        core.special_id(TOK, "abc")


def test_datum_fields_align():
    d = core.build_datum(TOK, GOLDEN_CASE)
    n = d.model_input.length
    assert d.loss_fn_inputs["target_tokens"].shape == [n]
    assert d.loss_fn_inputs["weights"].shape == [n]
    # only the completion tokens and the stop token carry weight
    n_target = len(TOK.encode("</think>" + completion(15))) + 1
    assert sum(d.loss_fn_inputs["weights"].data) == n_target


def test_disjoint_check():
    check_disjoint([{"id": "a", "split": "train"}], [{"id": "b", "split": "test"}])
    with pytest.raises(AssertionError):
        check_disjoint([{"id": "a", "split": "train"}], [{"id": "a", "split": "test"}])


def test_make_row_scores_and_schema():
    c = GOLDEN_CASE
    ok = core.make_row(c, '{"target": 15}', 500, 7, 0.4)
    bad = core.make_row(c, '{"target": 14}', 500, 7, 0.4)
    junk = core.make_row(c, "hello", 500, 3, 0.4)
    err = core.make_row(c, None, 500, 0, None)
    assert (ok["score"], bad["score"], junk["score"], err["score"]) == (1, 0, 0, 0)
    assert junk["pred"] is None and err["cost_usd"] is None and err["latency_ms"] is None
    for r in (ok, bad, junk, err):
        assert r["system"] == "lora" and {"id", "site", "sigma", "answer", "pred", "score", "latency_ms", "cost_usd", "raw"} <= set(r)


def test_mean_loss():
    class FB:
        metrics = {"loss:sum": 6.0, "response_tokens": 3.0}

    assert mean_loss(FB()) == 2.0
    assert mean_loss(object()) is None


def test_synthetic_cases_are_valid():
    cs = core.synthetic_cases(8)
    assert len(cs) == 8
    for c in cs:
        assert c["answer"] in {e["id"] for e in c["elements"]}
        assert core.build_example(TOK, c) is not None


def test_geo_variant_context_and_example():
    fx = json.loads((CONTRACTS / "fixtures" / "prompt_golden.json").read_text())
    ctx = core.context_text(GOLDEN_CASE, variant="geo")
    assert ctx == "[gMASK]<sop><|system|>Reasoning Effort: Max<|user|>" + fx["prompt_geo"] + "<|assistant|><think>"
    assert ctx != core.context_text(GOLDEN_CASE)
    tokens, weights = core.build_example(TOK, GOLDEN_CASE, variant="geo")
    n_ctx = len(core.prompt_tokens(TOK, GOLDEN_CASE, "geo"))
    assert tokens[:n_ctx] == core.prompt_tokens(TOK, GOLDEN_CASE, "geo") and sum(weights[:n_ctx]) == 0


def test_make_row_system_name():
    assert core.make_row(GOLDEN_CASE, '{"target": 15}', 10, 5, 0.1, "lora_geo")["system"] == "lora_geo"
    assert core.make_row(GOLDEN_CASE, '{"target": 15}', 10, 5, 0.1)["system"] == "lora"


def test_lr_schedule():
    assert core.lr_at(5e-5, "constant", 100, 158) == 5e-5
    assert core.lr_at(5e-5, "linear", 0, 158) == 5e-5
    last = core.lr_at(5e-5, "linear", 157, 158)
    assert 0 < last < 1e-6
    assert all(core.lr_at(5e-5, "linear", i, 158) > core.lr_at(5e-5, "linear", i + 1, 158) for i in range(157))


@pytest.fixture
def muse_format():
    core.use_format("muse")
    yield core.ACTIVE
    core.use_format("glm")


def test_muse_context_matches_shipped_template(muse_format):
    ctx = core.context_text(GOLDEN_CASE)
    assert ctx.startswith("<|begin_of_text|><|start|>system<|message|>You are a helpful AI assistant.")
    assert "Current date: " + core.MUSE_DATE in ctx
    assert ctx.endswith(build_prompt(GOLDEN_CASE) + "<|eot|><|start|>assistant")
    assert "<think>" not in ctx and "[gMASK]" not in ctx


def test_muse_target_is_plain_json_with_eot(muse_format):
    class T(FakeTok):
        SPECIALS = {"<|begin_of_text|>": 1, "<|start|>": 2, "<|message|>": 3, "<|eot|>": 4}

    t = T()
    tokens, weights = core.build_example(t, GOLDEN_CASE)
    n = len(core.prompt_tokens(t, GOLDEN_CASE))
    tail = t.decode(tokens[n:])
    assert tail == ' to=user<|message|>{"target": 15}<|eot|>'
    assert "</think>" not in tail
    assert tokens[-1] == 4 and weights[:n] == [0.0] * n and weights[n:] == [1.0] * (len(tokens) - n)


def test_format_switch_and_defaults():
    assert core.format_name_for("accounts/fireworks/models/muse-glimmer-30b") == "muse"
    assert core.format_name_for("accounts/fireworks/models/glm-5p3") == "glm"
    assert core.FORMATS["muse"].default_rank == 8 and core.FORMATS["glm"].default_rank == 16
    assert core.FORMATS["muse"].rows_system == "lora_muse"
    assert core.ACTIVE.name == "glm"
