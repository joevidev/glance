import { describe, expect, it } from 'vitest';
import { GazeCalibration } from './calibration';
import { FEATURE_COUNT } from './features';
import { calibrationPoints } from './points';
import { createRng } from './rng';
import { mkFrame } from './testutil';
import { simulateGaze } from './sim';

const SCREEN = { width: 1920, height: 1080 };

// Known linear map from a 14-dim feature vector to screen coords.
function synth(n: number, noise: number, seed: number) {
  const rng = createRng(seed);
  const pts = calibrationPoints(9);
  const rows: { f: number[]; t: { x: number; y: number } }[] = [];
  for (let i = 0; i < n; i++) {
    const t = pts[i % pts.length]!;
    const f = new Array<number>(FEATURE_COUNT).fill(0).map(() => 0.01 * rng.gauss());
    f[0] = 0.4 * (t.x - 0.5) + 0.003 * noise * rng.gauss();
    f[1] = 0.15 * (t.y - 0.5) + 0.003 * noise * rng.gauss();
    f[2] = 0.15 * (t.y - 0.5) + 0.003 * noise * rng.gauss();
    rows.push({ f, t });
  }
  return rows;
}

describe('GazeCalibration', () => {
  it('recovers a known linear mapping (clean) and reports ~0 error', () => {
    const c = new GazeCalibration({ degree: 1, ridge: 1e-4 });
    for (const r of synth(90, 0, 1)) c.addSample(mkFrame(0, { features: r.f }), r.t);
    const fit = c.fit(SCREEN);
    expect(fit.ok).toBe(true);
    expect(fit.samples).toBe(90);
    expect(fit.trainErrorPx).toBeLessThan(15);
    expect(fit.looErrorPx).toBeLessThan(25);
    const test = synth(18, 0, 99);
    for (const r of test) {
      const p = c.predict(mkFrame(0, { features: r.f }))!;
      expect(Math.abs(p.x - r.t.x)).toBeLessThan(0.03);
      expect(Math.abs(p.y - r.t.y)).toBeLessThan(0.03);
    }
  });

  it('with noise: prediction error stays small and LOO is sane (>= train, same order)', () => {
    const c = new GazeCalibration();
    for (const r of synth(180, 1, 2)) c.addSample(mkFrame(0, { features: r.f }), r.t);
    const fit = c.fit(SCREEN);
    expect(fit.ok).toBe(true);
    expect(fit.looErrorPx).toBeGreaterThanOrEqual(fit.trainErrorPx * 0.9);
    expect(fit.looErrorPx).toBeLessThan(250);
    let err = 0;
    const test = synth(90, 1, 77);
    for (const r of test) {
      const p = c.predict(mkFrame(0, { features: r.f }))!;
      err += Math.hypot((p.x - r.t.x) * SCREEN.width, (p.y - r.t.y) * SCREEN.height);
    }
    err /= test.length;
    expect(err).toBeLessThan(250);
    // LOO should predict held-out error to within a factor of ~3
    expect(fit.looErrorPx / err).toBeLessThan(3);
    expect(fit.looErrorPx / err).toBeGreaterThan(0.33);
  });

  it('is not ok with too few distinct targets and predict is null before fit', () => {
    const c = new GazeCalibration();
    expect(c.predict(mkFrame(0))).toBeNull();
    c.addSample(mkFrame(0), { x: 0.5, y: 0.5 });
    c.addSample(mkFrame(1), { x: 0.5, y: 0.5 });
    expect(c.fit(SCREEN).ok).toBe(false);
    expect(c.predict(mkFrame(0))).toBeNull();
  });

  it('ignores blink frames', () => {
    const c = new GazeCalibration();
    expect(c.addSample(mkFrame(0, { blinkLeft: 0.9 }), { x: 0.1, y: 0.1 })).toBe(false);
    expect(c.sampleCount).toBe(0);
  });

  it('degree 2 fits a curved mapping better than degree 1 (held-out interior points)', () => {
    const feat = (t: { x: number; y: number }, r: { gauss(): number }) => {
      const g = (t.x - 0.5) * 2;
      const f = new Array<number>(FEATURE_COUNT).fill(0);
      f[0] = g + 0.5 * g * g; // iris offset is a curved (perspective-like) function of screen x
      f[1] = (t.y - 0.5) * 2 + 0.002 * r.gauss();
      f[2] = 0.001 * r.gauss();
      return f;
    };
    const heldOut = (deg: 1 | 2) => {
      const c = new GazeCalibration({ degree: deg, ridge: 1e-3 });
      const r = createRng(5);
      const grid = calibrationPoints(16);
      for (let i = 0; i < 160; i++) c.addSample(mkFrame(0, { features: feat(grid[i % 16]!, r) }), grid[i % 16]!);
      c.fit(SCREEN);
      let err = 0;
      const n = 100;
      for (let i = 0; i < n; i++) {
        const t = { x: 0.15 + 0.7 * r.next(), y: 0.15 + 0.7 * r.next() };
        const p = c.predict(mkFrame(0, { features: feat(t, r) }))!;
        err += Math.hypot((p.x - t.x) * SCREEN.width, (p.y - t.y) * SCREEN.height);
      }
      return err / n;
    };
    expect(heldOut(2)).toBeLessThan(heldOut(1) * 0.8);
  });

  it('serializes and restores predictions exactly', () => {
    const c = new GazeCalibration();
    for (const r of synth(90, 1, 3)) c.addSample(mkFrame(0, { features: r.f }), r.t);
    c.fit(SCREEN);
    const c2 = GazeCalibration.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    const f = mkFrame(0, { features: synth(1, 1, 8)[0]!.f });
    expect(c2.predict(f)).toEqual(c.predict(f));
    expect(c2.isFitted).toBe(true);
  });

  it('learns from simulated gaze (end to end with sim.ts)', () => {
    const pts = calibrationPoints(9);
    const { frames, targets } = simulateGaze(pts, { msPerPoint: 1500, seed: 4 });
    const c = new GazeCalibration();
    frames.forEach((f, i) => {
      // skip the saccade at the start of each point
      if ((f.tsMs % 1500) > 500) c.addSample(f, targets[i]!);
    });
    const fit = c.fit(SCREEN);
    expect(fit.ok).toBe(true);
    expect(fit.looErrorPx).toBeLessThan(200);
  });
});
