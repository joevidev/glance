import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, GestureCalibrator, GestureDetector, type GestureEvent } from './gestures';
import { mkFrame } from './testutil';
import type { GazeFrame } from './types';

const DT = 33;

/** Run frames from `fn(t)` for [0, total] at 30 fps, collecting events. */
function run(det: GestureDetector, total: number, fn: (t: number) => Partial<Omit<GazeFrame, 'tsMs'>>): GestureEvent[] {
  const out: GestureEvent[] = [];
  for (let t = 0; t <= total; t += DT) out.push(...det.update(mkFrame(t, fn(t))));
  return out;
}
const types = (e: GestureEvent[]) => e.map((x) => x.type);

describe('winks', () => {
  it('left wink of 300 ms fires wink_left once', () => {
    const ev = run(new GestureDetector(), 1500, (t) => ({ blinkLeft: t >= 400 && t < 700 ? 0.9 : 0.05, blinkRight: 0.05 }));
    expect(types(ev)).toEqual(['wink_left']);
  });

  it('right wink of 300 ms fires wink_right', () => {
    const ev = run(new GestureDetector(), 1500, (t) => ({ blinkRight: t >= 400 && t < 700 ? 0.9 : 0.05 }));
    expect(types(ev)).toEqual(['wink_right']);
  });

  it('a natural two-eye blink of 150 ms does NOT fire', () => {
    const ev = run(new GestureDetector(), 1500, (t) => {
      const c = t >= 400 && t < 550;
      return { blinkLeft: c ? 0.95 : 0.05, blinkRight: c ? 0.95 : 0.05 };
    });
    expect(ev).toEqual([]);
  });

  it('a long two-eye blink with skewed edges (eyes differ by 1-3 frames) does NOT fire', () => {
    for (const skew of [33, 66, 99]) {
      for (const dur of [150, 300, 450]) {
        const ev = run(new GestureDetector(), 2000, (t) => ({
          blinkLeft: t >= 400 && t < 400 + dur ? 0.95 : 0.05,
          blinkRight: t >= 400 + skew && t < 400 + dur + skew ? 0.95 : 0.05,
        }));
        expect(ev, `skew ${skew} dur ${dur}`).toEqual([]);
      }
    }
  });

  it('a 2 s one-eye closure does NOT fire', () => {
    const ev = run(new GestureDetector(), 4000, (t) => ({ blinkLeft: t >= 400 && t < 2400 ? 0.9 : 0.05 }));
    expect(ev).toEqual([]);
  });

  it('a too-short one-eye closure (100 ms) does NOT fire', () => {
    const ev = run(new GestureDetector(), 1500, (t) => ({ blinkLeft: t >= 400 && t < 500 ? 0.9 : 0.05 }));
    expect(ev).toEqual([]);
  });

  it('a wink where the other eye squints (0.45, below blinkClosed) still fires; at 0.8 it does not', () => {
    const f = (other: number) => run(new GestureDetector(), 1500, (t) => ({ blinkLeft: t >= 400 && t < 700 ? 0.9 : 0.05, blinkRight: t >= 400 && t < 700 ? other : 0.05 }));
    expect(types(f(0.45))).toEqual(['wink_left']);
    expect(f(0.8)).toEqual([]);
  });

  it('hysteresis: a closure that flickers between 0.4 and 0.9 stays one wink', () => {
    const ev = run(new GestureDetector(), 1500, (t) => ({ blinkLeft: t >= 400 && t < 700 ? (Math.floor(t / DT) % 2 ? 0.9 : 0.4) : 0.05 }));
    expect(types(ev)).toEqual(['wink_left']);
  });

  it('double wink: second wink of the same eye within the gap becomes double_wink_left', () => {
    const ev = run(new GestureDetector(), 3000, (t) => ({
      blinkLeft: (t >= 400 && t < 700) || (t >= 900 && t < 1200) ? 0.9 : 0.05,
    }));
    expect(types(ev)).toEqual(['wink_left', 'double_wink_left']);
  });

  it('two winks far apart are two plain winks; different eyes never double', () => {
    const far = run(new GestureDetector(), 4000, (t) => ({ blinkLeft: (t >= 400 && t < 700) || (t >= 2500 && t < 2800) ? 0.9 : 0.05 }));
    expect(types(far)).toEqual(['wink_left', 'wink_left']);
    const mixed = run(new GestureDetector(), 3000, (t) => ({
      blinkLeft: t >= 400 && t < 700 ? 0.9 : 0.05,
      blinkRight: t >= 900 && t < 1200 ? 0.9 : 0.05,
    }));
    expect(types(mixed)).toEqual(['wink_left', 'wink_right']);
  });

  it('a third wink after a double starts over as a plain wink', () => {
    const w = [400, 900, 1400];
    const ev = run(new GestureDetector(), 3000, (t) => ({ blinkRight: w.some((s) => t >= s && t < s + 300) ? 0.9 : 0.05 }));
    expect(types(ev)).toEqual(['wink_right', 'double_wink_right', 'wink_right']);
  });
});

describe('eyes_closed_long', () => {
  const both = (from: number, to: number) => (t: number) => ({ blinkLeft: t >= from && t < to ? 0.9 : 0.05, blinkRight: t >= from && t < to ? 0.9 : 0.05 });

  it('a natural blink (150 ms) and a slow blink (400 ms) do NOT fire', () => {
    expect(run(new GestureDetector(), 2000, both(400, 550))).toEqual([]);
    expect(run(new GestureDetector(), 2000, both(400, 800))).toEqual([]);
  });

  it('a one-eye closure (2 s) does NOT fire, and no wink either', () => {
    expect(run(new GestureDetector(), 4000, (t) => ({ blinkLeft: t >= 400 && t < 2400 ? 0.9 : 0.05 }))).toEqual([]);
    expect(run(new GestureDetector(), 4000, (t) => ({ blinkRight: t >= 400 && t < 2400 ? 0.9 : 0.05 }))).toEqual([]);
  });

  it('a 700 ms double close fires exactly once, while the eyes are still closed', () => {
    const det = new GestureDetector();
    const ev = run(det, 3000, both(400, 2200));
    expect(types(ev)).toEqual(['eyes_closed_long']);
    expect(ev[0]!.tsMs).toBeGreaterThanOrEqual(400 + 700);
    expect(ev[0]!.tsMs).toBeLessThan(400 + 700 + 2 * DT);
  });

  it('a 1.5 s closure still fires only once, and emits no wink', () => {
    expect(types(run(new GestureDetector(), 3000, both(400, 1900)))).toEqual(['eyes_closed_long']);
  });

  it('just under the time (600 ms) does not fire; the time is configurable', () => {
    expect(run(new GestureDetector(), 2000, both(400, 1000))).toEqual([]);
    expect(types(run(new GestureDetector({ eyesClosedLongMs: 500 }), 2000, both(400, 1000)))).toEqual(['eyes_closed_long']);
  });

  it('re-arms after the eyes reopen: two separate long closes fire twice', () => {
    const ev = run(new GestureDetector(), 5000, (t) => {
      const c = (t >= 400 && t < 1400) || (t >= 2500 && t < 3500);
      return { blinkLeft: c ? 0.9 : 0.05, blinkRight: c ? 0.9 : 0.05 };
    });
    expect(types(ev)).toEqual(['eyes_closed_long', 'eyes_closed_long']);
  });

  it('a blink, then a pause, then a blink never adds up to a long close', () => {
    const ev = run(new GestureDetector(), 3000, (t) => {
      const c = (t >= 400 && t < 700) || (t >= 900 && t < 1200) || (t >= 1400 && t < 1700);
      return { blinkLeft: c ? 0.9 : 0.05, blinkRight: c ? 0.9 : 0.05 };
    });
    expect(ev).toEqual([]);
  });

  it('a 100 ms flicker of one eye in the middle of the close does not restart the timer', () => {
    const ev = run(new GestureDetector(), 3000, (t) => ({
      blinkLeft: t >= 400 && t < 1700 ? 0.9 : 0.05,
      blinkRight: t >= 700 && t < 800 ? 0.2 : t >= 400 && t < 1700 ? 0.9 : 0.05,
    }));
    expect(types(ev)).toEqual(['eyes_closed_long']);
  });

  it('a gap in the frame stream (camera stall) restarts the timer', () => {
    const det = new GestureDetector();
    const ev: GestureEvent[] = [];
    const f = (t: number) => ev.push(...det.update(mkFrame(t, { blinkLeft: 0.9, blinkRight: 0.9 })));
    f(400); f(433); f(466);
    f(1300); // 830 ms later: unknown what happened in between
    f(1333);
    expect(ev).toEqual([]);
  });

  it('a long close does not fire from a wink that the other eye joins late, and a wink afterwards still works', () => {
    const ev = run(new GestureDetector(), 4000, (t) => ({ blinkLeft: t >= 400 && t < 1700 ? 0.9 : t >= 2500 && t < 2800 ? 0.9 : 0.05, blinkRight: t >= 1500 && t < 1700 ? 0.9 : 0.05 }));
    expect(types(ev)).toEqual(['wink_left']);
  });

  it('calibrator: both-eyes-closed training is judged against the closed threshold', () => {
    const c = new GestureCalibrator();
    for (let i = 0; i < 60; i++) c.addNeutral(mkFrame(i * 33, { blinkLeft: 0.05, blinkRight: 0.06 }));
    for (let i = 0; i < 60; i++) c.addGesture('eyesClosed', mkFrame(i * 33, { blinkLeft: 0.9, blinkRight: 0.85 }));
    expect(c.result().works.eyesClosed).toBe(true);
    const weak = new GestureCalibrator();
    for (let i = 0; i < 60; i++) weak.addNeutral(mkFrame(i * 33, { blinkLeft: 0.05, blinkRight: 0.06 }));
    for (let i = 0; i < 60; i++) weak.addGesture('eyesClosed', mkFrame(i * 33, { blinkLeft: 0.9, blinkRight: 0.2 }));
    expect(weak.result().works.eyesClosed).toBe(false);
  });

  it('old saved thresholds without eyesClosedLongMs get the default', () => {
    const { eyesClosedLongMs: _drop, ...old } = { ...DEFAULT_THRESHOLDS };
    void _drop;
    expect(types(run(new GestureDetector(old), 3000, both(400, 2200)))).toEqual(['eyes_closed_long']);
  });
});

describe('mouth', () => {
  it('opens at mouthOpen, stays open through the hysteresis band, closes at mouthClose', () => {
    const det = new GestureDetector({ mouthOpen: 0.5, mouthClose: 0.25 });
    const seq = [0.1, 0.3, 0.55, 0.4, 0.3, 0.45, 0.2, 0.3, 0.1];
    const ev: GestureEvent[] = [];
    seq.forEach((j, i) => ev.push(...det.update(mkFrame(i * DT, { jawOpen: j }))));
    expect(ev.map((e) => [e.type, Math.round(e.tsMs / DT)])).toEqual([['mouth_open_start', 2], ['mouth_open_end', 6]]);
  });
});

describe('brows and scroll', () => {
  it('brows_up fires after being held, not for a flicker', () => {
    const flick = run(new GestureDetector(), 600, (t) => ({ browUp: t >= 200 && t < 250 ? 0.9 : 0 }));
    expect(flick).toEqual([]);
    const held = run(new GestureDetector(), 1000, (t) => ({ browUp: t >= 200 ? 0.9 : 0 }));
    expect(types(held)).toEqual(['brows_up']);
  });

  it('scroll velocity is + when pitch increases (nod down) and - when it decreases, only while brows are up', () => {
    const mk = (dir: 1 | -1, brows: number) =>
      run(new GestureDetector(), 2000, (t) => ({ browUp: brows, head: { yaw: 0, pitch: t > 600 ? dir * 0.5 * ((t - 600) / 1000) : 0, roll: 0 } }));
    const down = mk(1, 0.9).filter((e) => e.type === 'scroll');
    const up = mk(-1, 0.9).filter((e) => e.type === 'scroll');
    expect(down.length).toBeGreaterThan(10);
    expect(up.length).toBeGreaterThan(10);
    for (const e of down) expect(e.type === 'scroll' && e.velocity).toBeGreaterThan(0);
    for (const e of up) expect(e.type === 'scroll' && e.velocity).toBeLessThan(0);
    // magnitude ~ gain * (0.5 rad/s - deadzone)
    const v = down[down.length - 1]!;
    expect(v.type === 'scroll' && v.velocity).toBeGreaterThan(300);
    expect(mk(1, 0).filter((e) => e.type === 'scroll')).toEqual([]);
  });

  it('negative scrollGain flips direction', () => {
    const det = new GestureDetector({ scrollGain: -1200 });
    const ev = run(det, 2000, (t) => ({ browUp: 0.9, head: { yaw: 0, pitch: t > 600 ? 0.5 * ((t - 600) / 1000) : 0, roll: 0 } }));
    const s = ev.filter((e) => e.type === 'scroll');
    expect(s.length).toBeGreaterThan(5);
    for (const e of s) expect(e.type === 'scroll' && e.velocity).toBeLessThan(0);
  });
});

describe('GestureCalibrator', () => {
  const feed = (c: GestureCalibrator, name: 'winkLeft' | 'winkRight' | 'mouthOpen' | 'browsUp', o: Partial<Omit<GazeFrame, 'tsMs'>>, n = 30) => {
    for (let i = 0; i < n; i++) c.addGesture(name, mkFrame(i * DT, o));
  };

  it('detects what works and derives thresholds between neutral and gesture', () => {
    const c = new GestureCalibrator();
    for (let i = 0; i < 60; i++) c.addNeutral(mkFrame(i * DT, { blinkLeft: 0.05 + (i % 20 === 0 ? 0.8 : 0), blinkRight: 0.05, jawOpen: 0.05, browUp: 0.1 }));
    feed(c, 'winkLeft', { blinkLeft: 0.85, blinkRight: 0.1 });
    feed(c, 'winkRight', { blinkLeft: 0.15, blinkRight: 0.8 });
    feed(c, 'mouthOpen', { jawOpen: 0.7 });
    feed(c, 'browsUp', { browUp: 0.7 });
    const { thresholds: T, works } = c.result();
    // eyesClosed was not trained in this test: reported false (intended: the new gesture adds a works key)
    expect(works).toEqual({ winkLeft: true, winkRight: true, mouthOpen: true, browsUp: true, eyesClosed: false });
    expect(T.blinkClosed).toBeGreaterThan(0.3);
    expect(T.blinkClosed).toBeLessThan(0.8);
    expect(T.blinkOpen).toBeLessThan(T.blinkClosed);
    expect(T.mouthOpen).toBeGreaterThan(T.mouthClose);
    expect(T.mouthOpen).toBeLessThan(0.7);
    expect(T.browsUp).toBeGreaterThan(0.1);
    expect(T.browsUp).toBeLessThan(0.7);
  });

  it('flags gestures with no separation, or a wink where both eyes close', () => {
    const c = new GestureCalibrator();
    for (let i = 0; i < 60; i++) c.addNeutral(mkFrame(i * DT, { blinkLeft: 0.05, blinkRight: 0.05, jawOpen: 0.05, browUp: 0.1 }));
    feed(c, 'winkLeft', { blinkLeft: 0.85, blinkRight: 0.8 }); // cannot isolate one eye
    feed(c, 'winkRight', { blinkLeft: 0.1, blinkRight: 0.9 });
    feed(c, 'mouthOpen', { jawOpen: 0.15 }); // barely moves
    const { works, thresholds } = c.result();
    expect(works.winkLeft).toBe(false);
    expect(works.winkRight).toBe(true);
    expect(works.mouthOpen).toBe(false);
    expect(works.browsUp).toBe(false); // never provided
    expect(thresholds.mouthOpen).toBe(0.5); // unchanged default
  });

  it('personalized thresholds make the detector fire for this user', () => {
    const c = new GestureCalibrator();
    for (let i = 0; i < 60; i++) c.addNeutral(mkFrame(i * DT, { blinkLeft: 0.1, blinkRight: 0.1 }));
    feed(c, 'winkLeft', { blinkLeft: 0.5, blinkRight: 0.12 }); // a weak winker
    const { thresholds, works } = c.result();
    expect(works.winkLeft).toBe(true);
    const ev = run(new GestureDetector(thresholds), 1500, (t) => ({ blinkLeft: t >= 400 && t < 700 ? 0.5 : 0.1, blinkRight: 0.1 }));
    expect(types(ev)).toEqual(['wink_left']);
  });
});
