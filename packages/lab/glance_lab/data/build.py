"""Turn crawled pages (data/sites/*.json) into benchmark cases.

python -m glance_lab.data.build [--lock] [--seed 20261102]

Split by SITE (never by case). Gaze is SIMULATED: element center + Gaussian noise (per-axis
std sigma in {60,120,180} px, clamped to the viewport; webcam gaze error is ~100-200 px in the
literature, e.g. WebGazer, Papoutsaki et al. IJCAI 2016; WebEyeTrack, 2025). Commands come from
templates, not an LLM. If a LOCKED manifest exists, the test split is never touched: only train is
rebuilt (from sites that are not test sites).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

from glance_lab.common import DATASET, SITES, write_jsonl

SEED = 20261102
SIGMAS = [60, 120, 180]
MAX_SIGMA_MULT = 2.5
N_TEST_SITES = 8
TEST_CAP_PER_SITE = 45
TRAIN_CAP_PER_SITE = 90
MIX = {"deictic": 0.30, "role": 0.25, "partial_name": 0.30, "ordinal": 0.15}

ROLE_PHRASE = {
    "link": "link", "button": "button", "searchbox": "search box", "textbox": "text field",
    "combobox": "dropdown", "checkbox": "checkbox", "tab": "tab", "menuitem": "menu item",
    "radio": "radio button", "switch": "switch",
}
ROLE_VERB = {"link": ["open", "click", "go to"], "button": ["click", "press", "hit"], "searchbox": ["click", "focus", "select"],
             "textbox": ["click", "focus", "select"], "combobox": ["open", "click", "select"], "checkbox": ["tick", "toggle", "click"],
             "tab": ["open", "click", "switch to"], "menuitem": ["open", "click", "select"], "radio": ["select", "click", "pick"],
             "switch": ["toggle", "flip", "click"]}
DEICTIC = ["open that", "click this", "that one", "this one", "select that", "click that", "open this", "press that",
           "go there", "that", "this", "the one I'm looking at", "click on that", "open it"]
ORD = ["first", "second", "third", "fourth", "fifth"]
STOP = set("first second third fourth fifth last link button one that this tab box field the and for with from your you our are not all new that this have has can how what why who more about into out get was".split())


def box_dist(g, b) -> float:
    dx = max(b["x"] - g[0], 0, g[0] - (b["x"] + b["w"]))
    dy = max(b["y"] - g[1], 0, g[1] - (b["y"] + b["h"]))
    return math.hypot(dx, dy)


def center(b):
    return b["x"] + b["w"] / 2, b["y"] + b["h"] / 2


def nearest_id(g, els, restrict=None) -> tuple[int, bool]:
    """Nearest element to gaze by distance to box (0 if inside), tie -> nearest center. Returns (id, tied)."""
    cand = els if restrict is None else [e for e in els if e["id"] in restrict]
    keyed = sorted(((box_dist(g, e["box"]), math.dist(g, center(e["box"])), e["id"]) for e in cand))
    tied = len(keyed) > 1 and keyed[0][0] == keyed[1][0]
    return keyed[0][2], tied


def words(name: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-]*", name.lower())


def phrase_candidates(name: str) -> list[str]:
    w = words(name)
    out = []
    for i, a in enumerate(w):
        if len(a) >= 3 and a not in STOP:
            out.append(a)
        if i + 1 < len(w):
            b = w[i + 1]
            if len(a) >= 2 and len(b) >= 2 and not (a in STOP and b in STOP) and len(a) + len(b) >= 6:
                out.append(f"{a} {b}")
    return out


def name_has(name: str, phrase: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(phrase) + r"(?![a-z0-9])", " ".join(words(name))) is not None


def make_command(rng: random.Random, ctype: str, t: dict, els: list[dict], by_role: dict[str, list[dict]]):
    """Return (command, match_ids) or None. match_ids = every element the command alone fits."""
    role = t["role"]
    if ctype == "deictic":
        return rng.choice(DEICTIC), [e["id"] for e in els]
    if ctype == "role":
        if role not in ROLE_PHRASE:
            return None
        rp = ROLE_PHRASE[role]
        tpl = rng.choice(["the {r}", "the {r}", "that {r}", "{v} the {r}", "{v} the {r}"])
        cmd = tpl.format(r=rp, v=rng.choice(ROLE_VERB[role]))
        return cmd, [e["id"] for e in by_role[role]]
    if ctype == "ordinal":
        if role not in ROLE_PHRASE:
            return None
        same = by_role[role]
        rank = [e["id"] for e in same].index(t["id"])
        if rank >= len(ORD) or len(same) < 2:
            return None
        rp = ROLE_PHRASE[role]
        tpl = rng.choice(["the {o} {r}", "the {o} {r}", "{v} the {o} {r}"])
        return tpl.format(o=ORD[rank], r=rp, v=rng.choice(ROLE_VERB[role])), [same[rank]["id"]]
    if ctype == "partial_name":
        cands = phrase_candidates(t["name"])
        if not cands:
            return None
        cnt = {p: sum(name_has(e["name"], p) for e in els) for p in set(cands)}
        if rng.random() < 0.5:   # half the time prefer the most distinctive phrase, half the time any
            best = min(cnt.values())
            cands = [p for p in cands if cnt[p] == best]
        p = rng.choice(cands)
        opts = ["the {p} one", "{p}", "the {p} one", "click {p}", "open {p}"]
        match_role = None
        if role in ROLE_PHRASE and role in ("link", "button"):
            opts += ["the {p} {r}", "{v} the {p} {r}"]
        tpl = rng.choice(opts)
        if "{r}" in tpl:
            match_role = role
            cmd = tpl.format(p=p, r=ROLE_PHRASE[role], v=rng.choice(ROLE_VERB[role]))
        else:
            cmd = tpl.format(p=p)
        ids = [e["id"] for e in els if name_has(e["name"], p) and (match_role is None or e["role"] == match_role)]
        return cmd, ids
    raise ValueError(ctype)


def draw_gaze(rng: random.Random, t: dict, sigma: float, vw: int, vh: int):
    cx, cy = center(t["box"])
    for _ in range(50):
        gx = min(max(rng.gauss(cx, sigma), 0), vw - 1)
        gy = min(max(rng.gauss(cy, sigma), 0), vh - 1)
        if box_dist((gx, gy), t["box"]) <= MAX_SIGMA_MULT * sigma:
            return round(gx, 1), round(gy, 1)
    return None


def cases_for_page(rng: random.Random, page: dict, name: str, n: int, split: str) -> list[dict]:
    els = page["elements"]
    vw, vh = page["viewport"]["w"], page["viewport"]["h"]
    by_role: dict[str, list[dict]] = defaultdict(list)
    for e in els:
        by_role[e["role"]].append(e)
    types, weights = zip(*MIX.items())
    # ordinal targets: first five elements of a role that has >= 2 members (so "the second link" can be unambiguous)
    ord_pool = [e for r, L in by_role.items() if r in ROLE_PHRASE and len(L) >= 2 for e in L[: len(ORD)]]
    out, seen, tries = [], set(), 0
    while len(out) < n and tries < n * 30:
        tries += 1
        ctype = rng.choices(types, weights)[0]
        pool = ord_pool if ctype == "ordinal" else els
        if not pool:
            continue
        t = rng.choice(pool)
        sigma = rng.choice(SIGMAS)
        mc = make_command(rng, ctype, t, els, by_role)
        if mc is None:
            continue
        cmd, match = mc
        if t["id"] not in match:      # (a) answer must be consistent with the command
            continue
        key = (t["id"], ctype, cmd, sigma)
        if key in seen:
            continue
        g = draw_gaze(rng, t, sigma, vw, vh)   # (b) solvable by design
        if g is None:
            continue
        seen.add(key)
        out.append({
            "id": f"{split}-{name}-{len(out):03d}", "site": page["site"], "split": split,
            "viewport": {"w": vw, "h": vh}, "gaze": {"x": g[0], "y": g[1]}, "sigma": sigma,
            "command": cmd, "command_type": ctype, "elements": els, "answer": t["id"],
            "page": name, "n_command_matches": len(match), "_match": match,
        })
    return out


def load_pages():
    pages = defaultdict(list)
    for f in sorted(SITES.glob("*.json")):
        d = json.loads(f.read_text())
        pages[d["site"]].append((f.stem, d))
    return pages


def build_split(seed: int, sites: list[str], pages, split: str, cap: int) -> list[dict]:
    cases = []
    for s in sites:
        rng = random.Random(f"{seed}:{split}:{s}")
        pl = pages[s]
        per = math.ceil(cap / len(pl))
        sc = []
        for name, p in pl:
            sc += cases_for_page(rng, p, name, per, split)
        rng.shuffle(sc)
        sc = sc[:cap]
        for i, c in enumerate(sc):
            c["id"] = f"{split}-{s}-{i:03d}"
        cases += sc
    return cases


def report(cases: list[dict]) -> dict:
    by_sigma = defaultdict(list)
    by_type = defaultdict(list)
    comb = defaultdict(list)
    uniq, exp = [], []
    comb_sigma = defaultdict(list)
    comb_center = defaultdict(list)
    err = defaultdict(list)
    for c in cases:
        ans = c["elements"][c["answer"]]
        g0 = (c["gaze"]["x"], c["gaze"]["y"])
        err[c["sigma"]].append(math.dist(g0, center(ans["box"])))
        mids = c.get("_match") or [e["id"] for e in c["elements"]]
        best = min((math.dist(g0, center(c["elements"][i]["box"])), i) for i in mids)[1]
        comb_center[c["sigma"]].append(best == c["answer"])
        c["_nc"] = min((math.dist(g0, center(e["box"])), e["id"]) for e in c["elements"])[1] == c["answer"]
        ids = c.get("_match") or [e["id"] for e in c["elements"]]
        nid2, _ = nearest_id((c["gaze"]["x"], c["gaze"]["y"]), c["elements"], restrict=set(ids))
        comb_sigma[c["sigma"]].append(nid2 == c["answer"])
        g = (c["gaze"]["x"], c["gaze"]["y"])
        nid, _ = nearest_id(g, c["elements"])
        by_sigma[c["sigma"]].append(nid == c["answer"])
        by_type[c["command_type"]].append(nid == c["answer"])
        uniq.append(c["n_command_matches"] == 1)
        exp.append(1 / c["n_command_matches"])
    mean = lambda x: round(sum(x) / len(x), 4) if x else None
    n = len(cases)
    return {
        "n": n,
        "nearest_is_answer_by_sigma": {str(k): mean(v) for k, v in sorted(by_sigma.items())},
        "nearest_is_answer_overall": mean([x for v in by_sigma.values() for x in v]),
        "nearest_is_answer_by_command_type": {k: mean(v) for k, v in sorted(by_type.items())},
        "command_matches_exactly_one_overall": mean(uniq),
        "command_matches_exactly_one_by_type": {
            t: mean([c["n_command_matches"] == 1 for c in cases if c["command_type"] == t]) for t in MIX},
        "oracle_nearest_among_command_matches_by_sigma": {str(k): mean(v) for k, v in sorted(comb_sigma.items())},
        "oracle_nearest_center_among_command_matches_by_sigma": {str(k): mean(v) for k, v in sorted(comb_center.items())},
        "nearest_center_is_answer_overall": mean([c["_nc"] for c in cases]),
        "gaze_error_px_by_sigma": {str(k): {"mean": round(sum(v) / len(v), 1), "median": round(sorted(v)[len(v) // 2], 1)} for k, v in sorted(err.items())},
        "command_only_random_pick_expected_acc": mean(exp),
        "command_only_random_pick_expected_acc_by_type": {
            t: mean([1 / c["n_command_matches"] for c in cases if c["command_type"] == t]) for t in MIX},
        "sigma_mix": {str(k): v for k, v in sorted(Counter(c["sigma"] for c in cases).items())},
        "command_mix": dict(sorted(Counter(c["command_type"] for c in cases).items())),
    }


def strip(cases: list[dict]) -> list[dict]:
    return [{k: v for k, v in c.items() if k not in ("_match", "_nc")} for c in cases]


def sha256_file(p) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--lock", action="store_true", help="mark the test split final (never changes afterwards)")
    ap.add_argument("--n-test-sites", type=int, default=N_TEST_SITES)
    a = ap.parse_args()

    pages = load_pages()
    mpath, tpath, trpath = DATASET / "manifest.json", DATASET / "test.jsonl", DATASET / "train.jsonl"
    old = json.loads(mpath.read_text()) if mpath.exists() else None
    locked = bool(old and old.get("locked"))

    if locked:
        test_sites = old["test_sites"]
        assert sha256_file(tpath) == old["test_sha256"], "locked test.jsonl does not match manifest sha"
        seed = old["seed"]
        print(f"manifest is LOCKED: test split untouched ({len(test_sites)} sites); rebuilding train only")
    else:
        seed = a.seed
        eligible = sorted(s for s, pl in pages.items() if sum(len(p["elements"]) for _, p in pl) >= 40)
        rng = random.Random(f"{seed}:split")
        test_sites = sorted(rng.sample(eligible, a.n_test_sites))
    train_sites = sorted(s for s in pages if s not in set(test_sites))

    if not locked:
        test = build_split(seed, test_sites, pages, "test", TEST_CAP_PER_SITE)
        te_rep = report(test)
        write_jsonl(tpath, strip(test))
    else:
        from glance_lab.common import read_jsonl
        test = read_jsonl(tpath)
        te_rep = old["test_stats"]
    train = build_split(seed, train_sites, pages, "train", TRAIN_CAP_PER_SITE)
    tr_rep = report(train)
    write_jsonl(trpath, strip(train))

    assert not ({c["site"] for c in train} & {c["site"] for c in test}), "site leak"
    manifest = {
        "seed": seed,
        "n_sites_train": len({c["site"] for c in train}), "n_sites_test": len({c["site"] for c in test}),
        "n_pages": sum(len(v) for v in pages.values()),
        "n_train": len(train), "n_test": len(test),
        "test_sha256": sha256_file(tpath),
        "test_sites": test_sites, "train_sites": sorted({c["site"] for c in train}),
        "sigmas": {"values_px": SIGMAS, "meaning": "per-axis Gaussian std of simulated gaze noise around the element center, clamped to viewport; "
                   "cases are resampled so the answer box is within 2.5*sigma of the gaze point",
                   "justification": "webcam gaze error is ~100-200 px in published work (WebGazer, Papoutsaki et al. IJCAI 2016; WebEyeTrack 2025)",
                   "train_mix": tr_rep["sigma_mix"], "test_mix": te_rep["sigma_mix"]},
        "command_mix": {"target_weights": MIX, "train": tr_rep["command_mix"], "test": te_rep["command_mix"]},
        "caps_per_site": {"train": TRAIN_CAP_PER_SITE, "test": TEST_CAP_PER_SITE},
        "test_stats": te_rep, "train_stats": tr_rep,
        "locked": locked or a.lock,
        "created_at": old["created_at"] if locked else datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "notes": "gaze is simulated; commands are templated; split by site",
    }
    mpath.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({k: manifest[k] for k in ["n_sites_train", "n_sites_test", "n_train", "n_test", "locked", "test_sha256"]}, indent=1))
    print("test stats:", json.dumps(te_rep, indent=1))


if __name__ == "__main__":
    main()
