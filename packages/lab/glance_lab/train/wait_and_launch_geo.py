"""Poll results/geo_validation.md every 30 s; on `VERDICT: GO` launch the geo LoRA run (detached), on
`VERDICT: NO-GO` record it and stop. Gives up (no launch) after the cutoff so scored rows can still land
before the 14:45 PT deadline (training ~27 min + scoring ~2 min).

python -m glance_lab.train.wait_and_launch_geo [--cutoff HH:MM]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

from ..common import RESULTS, TRAIN_LOG

VERDICT = RESULTS / "geo_validation.md"
LOG = TRAIN_LOG / "geo_decision.log"


def note(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {msg}"
    print(line, flush=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cutoff", default="14:12", help="local HH:MM after which a GO is too late to launch")
    args = ap.parse_args()
    note("waiting for results/geo_validation.md")
    while True:
        first = ""
        if VERDICT.exists():
            lines = VERDICT.read_text().splitlines()
            first = lines[0] if lines else ""
        if first == "VERDICT: GO":
            if time.strftime("%H:%M") > args.cutoff:
                note(f"GO seen but past cutoff {args.cutoff}; NOT launching")
                return
            note("VERDICT: GO -> launching lora_geo")
            out = open(TRAIN_LOG / "run_geo.log", "w")
            subprocess.Popen(
                [sys.executable, "-m", "glance_lab.train.run", "--prompt-variant", "geo", "--lr", "5e-5", "--lr-schedule", "linear"],
                stdout=out, stderr=subprocess.STDOUT, start_new_session=True,
            )
            note("launched")
            return
        if first == "VERDICT: NO-GO":
            note("VERDICT: NO-GO -> not launching")
            return
        if first:
            note(f"unrecognised first line {first!r}; ignoring")
        time.sleep(30)


if __name__ == "__main__":
    main()
