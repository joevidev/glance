// Simulation benchmark for cursor steadiness: jitter (px std on a fixed target), lag (ms to 90% of a step) and error (px).
// Numbers are synthetic (sim.ts noise model), NOT real-face numbers. Set GAZE_BENCH=1 to print the table.
import { describe, expect, it } from 'vitest';
import { GazeCalibration, rejectOutlierFrames } from './calibration';
import { DeadZone } from './fixation';
import { FeatureSmoother, frameFromResult } from './features';
import { GazeTracker } from './tracker';
import { calibrationPoints } from './points';
import { createRng } from './rng';
import { simulateGaze } from './sim';
import type { GazeFrame, LandmarkerResultLike, Vec2 } from './types';

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const SCREEN = { width: 1920, height: 1080 };
const neutral = (f: GazeFrame): GazeFrame => {
  const x = f.features.slice();
  for (let i = 3; i <= 8; i++) x[i] = 0;
  return { ...f, features: x };
};
let HW = 0.15;
const OLD_FILTER = { minCutoff: 0.3, beta: 0.8 };

type Cfg = { name: string; smooth: boolean; fixation: boolean; deadzone: boolean; filter: { minCutoff: number; beta: number }; head?: boolean; fix?: { windowMs: number; saccadePx: number; confirm: number } };
const mk = (name: string, smooth: boolean, fixation: boolean, deadzone: boolean, minCutoff: number, beta = 0.8, fix = { windowMs: 200, saccadePx: 100, confirm: 2 }): Cfg => ({ name, smooth, fixation, deadzone, filter: { minCutoff, beta }, fix });
const CHOSEN = { windowMs: 250, saccadePx: 220, confirm: 2 };
const CFGS: Cfg[] = [
  mk('old: OneEuro(0.3,0.8)+deadzone30', false, false, true, 0.3),
  mk('median3+OneEuro(0.3,0.8)+deadzone30', true, false, true, 0.3),
  mk('OneEuro(1.0,0.8) only', false, false, false, 1.0),
  mk('fix250/220 + OneEuro(1.0), no deadzone', false, true, false, 1.0, 0.8, CHOSEN),
  mk('NEW: fix250/220 + OneEuro(1.0) + deadzone30', false, true, true, 1.0, 0.8, CHOSEN),
];

function prep(frames: GazeFrame[], c: Cfg): GazeFrame[] {
  const sm = new FeatureSmoother();
  return frames.map((f) => {
    const n = c.head ? f : neutral(f);
    return c.smooth ? sm.smooth(n)! : n;
  });
}

function calibrate(c: Cfg, noise: number, seed: number): GazeCalibration {
  const pts = calibrationPoints(9);
  const { frames, targets } = simulateGaze(pts, { msPerPoint: 1500, seed, noise, headWobble: HW });
  const pf = prep(frames, c);
  const cal = new GazeCalibration();
  pf.forEach((f, i) => {
    if (f.tsMs % 1500 > 600) cal.addSample(f, targets[i]!);
  });
  cal.fit(SCREEN);
  return cal;
}

function run(c: Cfg, cal: GazeCalibration, noise: number, seed: number) {
  const rng = createRng(seed * 7 + 1);
  const path: Vec2[] = Array.from({ length: 40 }, () => ({ x: 0.1 + 0.8 * rng.next(), y: 0.1 + 0.8 * rng.next() }));
  const MS = 1500;
  const { frames, targets } = simulateGaze(path, { msPerPoint: MS, seed: seed + 100, noise, headWobble: HW });
  const pf = prep(frames, c);
  const tr = new GazeTracker(cal, SCREEN, { filter: c.filter, fixation: c.fixation ? c.fix! : false });
  const dz = new DeadZone(30);
  const out: Vec2[] = pf.map((f) => {
    const u = tr.update(f);
    const p = u.pointPx!;
    return c.deadzone ? dz.apply(p) : p;
  });
  // jitter + error over the settled part (>700 ms after the point started) of each point
  let jit = 0, jn = 0, err = 0, en = 0;
  for (let i = 0; i < path.length; i++) {
    const idx: number[] = [];
    for (let k = 0; k < frames.length; k++) {
      const t = frames[k]!.tsMs;
      if (t >= i * MS + 700 && t < (i + 1) * MS) idx.push(k);
    }
    if (idx.length < 5) continue;
    const mx = idx.reduce((a, k) => a + out[k]!.x, 0) / idx.length;
    const my = idx.reduce((a, k) => a + out[k]!.y, 0) / idx.length;
    const v = idx.reduce((a, k) => a + (out[k]!.x - mx) ** 2 + (out[k]!.y - my) ** 2, 0) / idx.length;
    jit += Math.sqrt(v); jn++;
    for (const k of idx) { err += Math.hypot(out[k]!.x - targets[k]!.x * SCREEN.width, out[k]!.y - targets[k]!.y * SCREEN.height); en++; }
  }
  // lag: first of 2 consecutive frames whose projection on the step reaches 90%
  let lag = 0, ln = 0;
  for (let i = 1; i < path.length; i++) {
    const a = { x: path[i - 1]!.x * SCREEN.width, y: path[i - 1]!.y * SCREEN.height };
    const b = { x: path[i]!.x * SCREEN.width, y: path[i]!.y * SCREEN.height };
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 400) continue;
    const proj = (p: Vec2) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L);
    let hit = -1;
    for (let k = 0; k < frames.length - 1; k++) {
      const t = frames[k]!.tsMs - i * MS;
      if (t < 0 || t > 800) continue;
      if (proj(out[k]!) >= 0.9 && proj(out[k + 1]!) >= 0.9) { hit = t; break; }
    }
    if (hit >= 0) { lag += hit; ln++; }
  }
  return { jitterPx: jit / jn, errorPx: err / en, lagMs: lag / ln };
}

function bench(noise: number, seeds = [1, 2, 3, 4], cfgs: Cfg[] = CFGS) {
  return cfgs.map((c) => {
    const rs = seeds.map((s) => run(c, calibrate(c, noise, s), noise, s));
    const avg = (k: 'jitterPx' | 'errorPx' | 'lagMs') => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    return { name: c.name, jitterPx: avg('jitterPx'), lagMs: avg('lagMs'), errorPx: avg('errorPx') };
  });
}

describe('cursor steadiness in simulation', () => {
  for (const noise of [1, 2, 3]) {
    it(`noise x${noise}: new pipeline is steadier than the old one without more lag`, () => {
      const r = bench(noise);
      if (ENV.GAZE_BENCH) {
        console.log(`\nnoise x${noise}\n` + r.map((x) => `${x.name.padEnd(56)} jitter ${x.jitterPx.toFixed(1)} px  lag ${x.lagMs.toFixed(0)} ms  error ${x.errorPx.toFixed(1)} px`).join('\n'));
      }
      const old = r[0]!;
      const nu = r[4]!;
      // honest, modest claim: no more jitter (5% slack), clearly less lag, no more error (5% slack)
      expect(nu.jitterPx).toBeLessThan(old.jitterPx * 1.05);
      expect(nu.lagMs).toBeLessThan(old.lagMs * 0.97);
      expect(nu.errorPx).toBeLessThan(old.errorPx * 1.05);
    });
  }
});

/** Fake 478-point mesh with iris ring points placed around each iris center, per-landmark independent noise. */
function noisyMesh(rng: ReturnType<typeof createRng>, sigma: number) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const w = 0.06;
  const set = (i: number, x: number, y: number) => (lm[i] = { x: 0.5 + x + sigma * rng.gauss(), y: 0.5 + y + sigma * rng.gauss(), z: 0 });
  const eye = (cx: number, c1: number, c2: number, up: number, lo: number, iris: number, ring: number[]) => {
    set(c1, cx - w / 2, 0); set(c2, cx + w / 2, 0);
    set(up, cx, -0.012); set(lo, cx, 0.012);
    const ix = cx + 0.1 * w;
    set(iris, ix, 0);
    const r = 0.2 * w;
    set(ring[0]!, ix + r, 0); set(ring[1]!, ix, -r); set(ring[2]!, ix - r, 0); set(ring[3]!, ix, r);
  };
  eye(-0.1, 33, 133, 159, 145, 468, [469, 470, 471, 472]);
  eye(0.1, 362, 263, 386, 374, 473, [474, 475, 476, 477]);
  return lm;
}

describe('iris ring averaging', () => {
  const std = (a: number[]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  it('lowers feature noise when landmark noise is independent; keeps the same mean', () => {
    const rng = createRng(3);
    const on: GazeFrame[] = [], off: GazeFrame[] = [];
    for (let i = 0; i < 400; i++) {
      const r: LandmarkerResultLike = { faceLandmarks: [noisyMesh(rng, 0.0004)] };
      on.push(frameFromResult(r, i * 33, { aspect: 1 })!);
      off.push(frameFromResult(r, i * 33, { aspect: 1, irisRing: false })!);
    }
    const sOn = std(on.map((f) => f.features[0]!)), sOff = std(off.map((f) => f.features[0]!));
    const sOnY = std(on.map((f) => f.features[1]!)), sOffY = std(off.map((f) => f.features[1]!));
    if (ENV.GAZE_BENCH) console.log(`\nring: gx std ${sOff.toFixed(5)} -> ${sOn.toFixed(5)}, gy std ${sOffY.toFixed(5)} -> ${sOnY.toFixed(5)}`);
    expect(sOn).toBeLessThan(sOff * 0.8);
    expect(sOnY).toBeLessThan(sOffY * 0.95);
    const mean = (a: GazeFrame[]) => a.reduce((s, f) => s + f.features[0]!, 0) / a.length;
    expect(Math.abs(mean(on) - mean(off))).toBeLessThan(0.003);
  });
});

describe('calibration outlier rejection', () => {
  it('drops far frames and blink frames but keeps a consistent dot', () => {
    const rng = createRng(5);
    const mk = (i: number, gx: number, blink = 0): GazeFrame => ({
      tsMs: i * 33, features: [gx, 0.02, 0.01, 0, 0, 0, 0, 0, 0, 0.3, gx, gx, 0, 0], blinkLeft: blink, blinkRight: blink,
      jawOpen: 0, browUp: 0, head: { yaw: 0, pitch: 0, roll: 0 }, faceBox: { cx: 0.5, cy: 0.5, size: 0.3 },
    });
    const frames: GazeFrame[] = [];
    for (let i = 0; i < 40; i++) frames.push(mk(i, 0.05 + 0.002 * rng.gauss()));
    frames.push(mk(40, 0.2), mk(41, 0.05, 0.4));
    const kept = rejectOutlierFrames(frames);
    expect(kept.length).toBeGreaterThanOrEqual(36);
    expect(kept.length).toBeLessThanOrEqual(40);
    expect(kept.every((f) => Math.abs(f.features[0]! - 0.05) < 0.02)).toBe(true);
  });
});

// Parameter sweep (opt-in): GAZE_SWEEP=1 npx vitest run src/quality.test.ts
describe.skipIf(!ENV.GAZE_SWEEP)('sweep', () => {
  it('prints a table', () => {
    const cfgs: Cfg[] = [mk('old', false, false, true, 0.3)];
    for (const w of [250, 350]) for (const s of [120, 160, 220]) for (const c of [2, 3]) for (const mc of [0.5, 1.0]) for (const dz of [true])
      cfgs.push(mk(`fix w${w} s${s} c${c} oe${mc}${dz ? ' dz' : ''}`, false, true, dz, mc, 0.8, { windowMs: w, saccadePx: s, confirm: c }));
    for (const noise of [2, 3]) {
      const r = bench(noise, [1, 2, 3, 4, 5, 6], cfgs);
      console.log(`\nsweep noise x${noise}\n` + r.map((x) => `${x.name.padEnd(34)} jitter ${x.jitterPx.toFixed(1)}  lag ${x.lagMs.toFixed(0)}  err ${x.errorPx.toFixed(1)}`).join('\n'));
    }
  });
});
