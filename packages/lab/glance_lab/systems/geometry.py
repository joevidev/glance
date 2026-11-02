"""Deterministic baselines that use only geometry (no model).

raw_gaze (system 0): the element whose box contains the gaze point. If several boxes
contain it, the smallest one wins (the innermost thing under the cursor). No box
contains it -> None, which is scored as wrong.

nearest (system 1): the element with the smallest point-to-box distance (0 when the
gaze is inside the box). Ties go to the smaller area, then the smaller id.
"""
from __future__ import annotations

import math


def box_distance(gx: float, gy: float, box: dict) -> float:
    x, y, w, h = box["x"], box["y"], box["w"], box["h"]
    dx = max(x - gx, 0.0, gx - (x + w))
    dy = max(y - gy, 0.0, gy - (y + h))
    return math.hypot(dx, dy)


def contains(gx: float, gy: float, box: dict) -> bool:
    return box["x"] <= gx <= box["x"] + box["w"] and box["y"] <= gy <= box["y"] + box["h"]


def _area(box: dict) -> float:
    return box["w"] * box["h"]


def raw_gaze(case: dict) -> int | None:
    g = case["gaze"]
    hits = [e for e in case["elements"] if contains(g["x"], g["y"], e["box"])]
    if not hits:
        return None
    return min(hits, key=lambda e: (_area(e["box"]), e["id"]))["id"]


def ranked_by_distance(case: dict) -> list[dict]:
    g = case["gaze"]
    return sorted(case["elements"], key=lambda e: (box_distance(g["x"], g["y"], e["box"]), _area(e["box"]), e["id"]))


def nearest(case: dict) -> int | None:
    r = ranked_by_distance(case)
    return r[0]["id"] if r else None


def top_k(case: dict, k: int = 5) -> list[dict]:
    """The k nearest elements, returned in their ORIGINAL on-screen order."""
    keep = {e["id"] for e in ranked_by_distance(case)[:k]}
    return [e for e in case["elements"] if e["id"] in keep]
