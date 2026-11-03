"""Follow-up for a systems run. usage: python3 results/monitor_run.py open_base=360 frontier=360 harness_vote=1800
Every 90 s prints cache files vs expected per system; flags STUCK (2 checks without movement) and WRONG (>110%)."""
import sys, time, pathlib
root = pathlib.Path(__file__).resolve().parent
exp = {a.split("=")[0]: int(a.split("=")[1]) for a in sys.argv[1:]}
last, stuck = {}, {}
while True:
    done, parts = True, []
    for s, e in exp.items():
        d = root / "cache" / s
        n = sum(1 for _ in d.iterdir()) if d.exists() else 0
        m = f"{s} {n}/{e}"
        if n > e * 1.1: m += " WRONG(>110%) STOP"
        if n < e:
            done = False
            stuck[s] = stuck.get(s, 0) + 1 if last.get(s) == n else 0
            if stuck[s] >= 2: m += f" STUCK({stuck[s]})"
        last[s] = n; parts.append(m)
    print(time.strftime("%H:%M:%S"), " | ".join(parts), flush=True)
    if done:
        print("ALL_CACHES_COMPLETE", flush=True); break
    time.sleep(90)
