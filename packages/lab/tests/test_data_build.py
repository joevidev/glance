import hashlib
import json
import random

import pytest

from glance_lab.common import CONTRACTS, DATASET, read_jsonl
from glance_lab.data import build


def _check(schema: dict, val, path="case"):
    """Minimal JSON-schema subset checker (jsonschema is not installed): type, required, enum, properties, items, $ref, minimum."""
    if "$ref" in schema:
        schema = json.loads((CONTRACTS / "schema" / schema["$ref"]).read_text())
    if "enum" in schema:
        assert val in schema["enum"], f"{path}: {val!r} not in enum"
    t = schema.get("type")
    py = {"string": str, "integer": int, "number": (int, float), "object": dict, "array": list}
    if t:
        assert isinstance(val, py[t]) and not isinstance(val, bool), f"{path}: expected {t}, got {type(val).__name__}"
    if "minimum" in schema:
        assert val >= schema["minimum"], path
    if "maxLength" in schema:
        assert len(val) <= schema["maxLength"], path
    if t == "object":
        for r in schema.get("required", []):
            assert r in val, f"{path}: missing {r}"
        for k, sub in schema.get("properties", {}).items():
            if k in val:
                _check(sub, val[k], f"{path}.{k}")
    if t == "array" and "items" in schema:
        for i, x in enumerate(val):
            _check(schema["items"], x, f"{path}[{i}]")


def _toy_page():
    els = []
    for i in range(30):
        els.append({"id": i, "role": "link" if i % 3 else "button", "name": f"Item {['alpha','beta','gamma','delta'][i%4]} number {i}",
                    "box": {"x": 40 + (i % 5) * 250, "y": 40 + (i // 5) * 90, "w": 200, "h": 30}})
    return {"site": "toy.test", "url": "https://toy.test/", "viewport": {"w": 1440, "h": 900}, "elements": els}


def _cases(seed=1, n=40):
    return build.cases_for_page(random.Random(seed), _toy_page(), "toy.test__0", n, "train")


def test_determinism():
    assert _cases(7) == _cases(7)
    assert _cases(7) != _cases(8)


def test_case_invariants():
    cs = _cases()
    assert len(cs) == 40
    for c in cs:
        ids = {e["id"] for e in c["elements"]}
        assert c["answer"] in ids
        assert 0 <= c["gaze"]["x"] < c["viewport"]["w"] and 0 <= c["gaze"]["y"] < c["viewport"]["h"]
        ans = next(e for e in c["elements"] if e["id"] == c["answer"])
        assert build.box_dist((c["gaze"]["x"], c["gaze"]["y"]), ans["box"]) <= 2.5 * c["sigma"] + 1e-6
        assert c["sigma"] in build.SIGMAS
        assert c["n_command_matches"] >= 1


def test_command_consistency():
    for c in _cases(3, 80):
        ans = next(e for e in c["elements"] if e["id"] == c["answer"])
        cmd = c["command"]
        if c["command_type"] == "role":
            assert build.ROLE_PHRASE[ans["role"]] in cmd
        if c["command_type"] == "ordinal":
            same = [e for e in c["elements"] if e["role"] == ans["role"]]
            assert build.ORD[[e["id"] for e in same].index(ans["id"])] in cmd
            assert c["n_command_matches"] == 1


def test_schema_valid_toy():
    schema = json.loads((CONTRACTS / "schema" / "case.schema.json").read_text())
    for c in _cases():
        _check(schema, c)


@pytest.mark.skipif(not (DATASET / "manifest.json").exists(), reason="dataset not built yet")
def test_built_dataset():
    m = json.loads((DATASET / "manifest.json").read_text())
    train, test = read_jsonl(DATASET / "train.jsonl"), read_jsonl(DATASET / "test.jsonl")
    assert not ({c["site"] for c in train} & {c["site"] for c in test}), "site in both splits"
    assert all(c["split"] == "train" for c in train) and all(c["split"] == "test" for c in test)
    assert m["n_train"] == len(train) and m["n_test"] == len(test)
    if m.get("locked"):
        assert hashlib.sha256((DATASET / "test.jsonl").read_bytes()).hexdigest() == m["test_sha256"]
    schema = json.loads((CONTRACTS / "schema" / "case.schema.json").read_text())
    rng = random.Random(0)
    for c in rng.sample(train, min(100, len(train))) + rng.sample(test, min(100, len(test))):
        _check(schema, c)
        assert c["answer"] in {e["id"] for e in c["elements"]}
        assert 0 <= c["gaze"]["x"] < c["viewport"]["w"] and 0 <= c["gaze"]["y"] < c["viewport"]["h"]
    ids = [c["id"] for c in train + test]
    assert len(ids) == len(set(ids))
