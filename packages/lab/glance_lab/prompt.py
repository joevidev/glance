"""The intent prompt. The TypeScript twin lives in packages/contracts/src/prompt.ts.

Both must render byte-identical text; packages/contracts/fixtures/prompt_golden.json
is the contract. Do not change the templates or the element line format without
regenerating the fixture (python -m glance_lab.prompt --golden) and telling the
desktop agent: the eval and the app must use the same prompt.
"""
from __future__ import annotations

import json
import sys

from .common import CONTRACTS, PROMPTS


def render_element(e: dict) -> str:
    b = e["box"]
    name = " ".join(str(e["name"]).split()).replace('"', "'")
    x, y, w, h = (round(b[k]) for k in ("x", "y", "w", "h"))
    return f'[{e["id"]}] {e["role"]} "{name}" @{x},{y},{w},{h}'


def render_elements(elements: list[dict]) -> str:
    return "\n".join(render_element(e) for e in elements)


def gaze_distance(e: dict, gx: float, gy: float) -> int:
    """Distance in px from the gaze point to the element box (0 if inside), rounded."""
    b = e["box"]
    dx = max(b["x"] - gx, 0, gx - (b["x"] + b["w"]))
    dy = max(b["y"] - gy, 0, gy - (b["y"] + b["h"]))
    return round((dx * dx + dy * dy) ** 0.5)


def render_elements_geo(case: dict) -> str:
    """Geometry done in code: elements sorted by distance to the gaze point (ties by id), each with d=<px>."""
    gx, gy = case["gaze"]["x"], case["gaze"]["y"]
    rows = sorted(case["elements"], key=lambda e: (gaze_distance(e, gx, gy), e["id"]))
    return "\n".join(f"{render_element(e)} d={gaze_distance(e, gx, gy)}" for e in rows)


def build_prompt(case: dict, *, with_gaze: bool = True, variant: str = "plain") -> str:
    """variant: "plain" (the original prompt) or "geo" (elements ranked by distance to the gaze point)."""
    if variant == "geo":
        tpl = (PROMPTS / "intent_geo.txt").read_text().rstrip("\n")
        return (
            tpl.replace("{{width}}", str(case["viewport"]["w"]))
            .replace("{{height}}", str(case["viewport"]["h"]))
            .replace("{{command}}", case["command"])
            .replace("{{elements}}", render_elements_geo(case))
            .replace("{{gaze_x}}", str(round(case["gaze"]["x"])))
            .replace("{{gaze_y}}", str(round(case["gaze"]["y"])))
        )
    tpl = (PROMPTS / ("intent.txt" if with_gaze else "intent_command_only.txt")).read_text().rstrip("\n")
    out = (
        tpl.replace("{{width}}", str(case["viewport"]["w"]))
        .replace("{{height}}", str(case["viewport"]["h"]))
        .replace("{{command}}", case["command"])
        .replace("{{elements}}", render_elements(case["elements"]))
    )
    if with_gaze:
        out = out.replace("{{gaze_x}}", str(round(case["gaze"]["x"]))).replace("{{gaze_y}}", str(round(case["gaze"]["y"])))
    return out


def completion(answer: int) -> str:
    """The exact assistant text used as the training target."""
    return json.dumps({"target": answer})


def parse_decision(text: str) -> int | None:
    """Pull {"target": N} out of a model reply. None if it cannot be parsed."""
    import re

    m = re.search(r'"target"\s*:\s*(-?\d+|null)', text or "")
    if not m or m.group(1) == "null":
        return None
    return int(m.group(1))


GOLDEN_CASE = {
    "id": "golden-1", "site": "example.com", "split": "test",
    "viewport": {"w": 1280, "h": 800}, "gaze": {"x": 812.4, "y": 430.6}, "sigma": 120,
    "command": "open that", "command_type": "deictic", "answer": 15,
    "elements": [
        {"id": 14, "role": "link", "name": "Re: Demo tomorrow at 3", "box": {"x": 100.2, "y": 300.5, "w": 600.4, "h": 48.0}},
        {"id": 15, "role": "link", "name": "Re: \"Invoice\"  #4821", "box": {"x": 100, "y": 380, "w": 600, "h": 48}},
        {"id": 16, "role": "button", "name": "Weekly update", "box": {"x": 100, "y": 460, "w": 600, "h": 48}},
    ],
}

if __name__ == "__main__":
    if "--golden" in sys.argv:
        fx = {
            "case": GOLDEN_CASE,
            "prompt_with_gaze": build_prompt(GOLDEN_CASE, with_gaze=True),
            "prompt_command_only": build_prompt(GOLDEN_CASE, with_gaze=False),
            "prompt_geo": build_prompt(GOLDEN_CASE, variant="geo"),
            "completion": completion(GOLDEN_CASE["answer"]),
        }
        (CONTRACTS / "fixtures" / "prompt_golden.json").write_text(json.dumps(fx, indent=2, ensure_ascii=False) + "\n")
        print("wrote prompt_golden.json")
