import { POLY_CORE } from './features';
import { invertMatrix, matMul, transpose } from './linalg';
import type { GazeFrame, ScreenSize, Vec2 } from './types';

type Sample = { f: number[]; t: Vec2 };

type Model = {
  degree: 1 | 2;
  ridge: number; // relative to n (lambda_eff = ridge * n)
  m1: number[]; s1: number[]; // stage 1: standardize raw features
  m2: number[]; s2: number[]; // stage 2: standardize expanded columns
  w: number[][]; // p x 2
  b: Vec2;
};

export type FitResult = { ok: boolean; samples: number; looErrorPx: number; trainErrorPx: number };

const RIDGE_GRID = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1];

function colStats(rows: number[][]): { mean: number[]; std: number[] } {
  const n = rows.length;
  const d = rows[0]?.length ?? 0;
  const mean = new Array<number>(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] = mean[j]! + r[j]! / n;
  const std = new Array<number>(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) std[j] = std[j]! + (r[j]! - mean[j]!) ** 2 / n;
  return { mean, std: std.map((v) => (Math.sqrt(v) > 1e-9 ? Math.sqrt(v) : 1)) };
}

/** Expand standardized features z: degree 2 adds all products among the first POLY_CORE features. */
function expand(z: number[], degree: 1 | 2): number[] {
  const out = z.slice();
  if (degree === 2) {
    const k = Math.min(POLY_CORE, z.length);
    for (let i = 0; i < k; i++) for (let j = i; j < k; j++) out.push(z[i]! * z[j]!);
  }
  return out;
}

/**
 * Ridge regression from frame features to normalized screen coordinates. Closed form, no deps.
 *
 * - Features are standardized, optionally expanded to a degree-2 polynomial (squares and cross terms of
 *   the core gaze features), then standardized again so the ridge penalty is fair across columns.
 * - `ridge` is relative to the sample count (penalty = ridge * n). If omitted, fit() picks it from a
 *   small grid by leave-one-out error. If `degree` is omitted, fit() tries 1 and 2 and keeps the one with
 *   the lower leave-one-out error.
 * - Leave-one-out is computed per TARGET (all frames of one calibration dot are left out together), using
 *   the exact ridge hat-matrix identity, so near-duplicate frames of a dot do not flatter the number.
 *   Standardization statistics are taken from all data (tiny optimistic bias).
 */
export class GazeCalibration {
  private readonly opts: { ridge?: number; degree?: 1 | 2 };
  private samples: Sample[] = [];
  private model: Model | null = null;
  private screen: ScreenSize | null = null;
  private lastFit: FitResult | null = null;

  constructor(opts?: { ridge?: number; degree?: 1 | 2 }) {
    this.opts = { ...(opts?.ridge !== undefined ? { ridge: opts.ridge } : {}), ...(opts?.degree !== undefined ? { degree: opts.degree } : {}) };
  }

  get sampleCount(): number { return this.samples.length; }
  get isFitted(): boolean { return this.model !== null; }
  get fitResult(): FitResult | null { return this.lastFit; }
  get chosen(): { degree: 1 | 2; ridge: number } | null { return this.model ? { degree: this.model.degree, ridge: this.model.ridge } : null; }

  clear(): void {
    this.samples = [];
    this.model = null;
    this.lastFit = null;
  }

  /**
   * Add a sample: `target` is the normalized screen position (0..1) the user is looking at.
   * Frames with a closed eye (either blink score > 0.5) or non-finite features are ignored; returns whether it was kept.
   */
  addSample(frame: GazeFrame, target: Vec2): boolean {
    if (Math.max(frame.blinkLeft, frame.blinkRight) > 0.5) return false;
    if (!frame.features.every(Number.isFinite) || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    const d = this.samples[0]?.f.length;
    if (d !== undefined && d !== frame.features.length) throw new Error(`feature length ${frame.features.length} != ${d}`);
    this.samples.push({ f: frame.features.slice(), t: { x: target.x, y: target.y } });
    return true;
  }

  fit(screen: ScreenSize): FitResult {
    const n = this.samples.length;
    const keys = new Map<string, number[]>();
    this.samples.forEach((s, i) => {
      const k = `${s.t.x.toFixed(5)},${s.t.y.toFixed(5)}`;
      const g = keys.get(k);
      if (g) g.push(i);
      else keys.set(k, [i]);
    });
    const groups = [...keys.values()];
    this.screen = { ...screen };
    if (n < 3 || groups.length < 3) {
      this.model = null;
      this.lastFit = { ok: false, samples: n, looErrorPx: Infinity, trainErrorPx: Infinity };
      return this.lastFit;
    }

    const raw = this.samples.map((s) => s.f);
    const { mean: m1, std: s1 } = colStats(raw);
    const Z = raw.map((r) => r.map((v, j) => (v - m1[j]!) / s1[j]!));
    const T = this.samples.map((s) => [s.t.x, s.t.y]);
    const tMean = [0, 1].map((c) => T.reduce((a, r) => a + r[c]!, 0) / n);
    const Tc = T.map((r) => [r[0]! - tMean[0]!, r[1]! - tMean[1]!]);

    const degrees: (1 | 2)[] = this.opts.degree ? [this.opts.degree] : [1, 2];
    const ridges = this.opts.ridge !== undefined ? [this.opts.ridge] : RIDGE_GRID;

    let best: { loo: number; train: number; model: Model } | null = null;
    for (const degree of degrees) {
      const E = Z.map((z) => expand(z, degree));
      const { mean: m2, std: s2 } = colStats(E);
      const X = E.map((r) => r.map((v, j) => (v - m2[j]!) / s2[j]!));
      const Xt = transpose(X);
      const XtX = matMul(Xt, X);
      const p = XtX.length;
      for (const ridge of ridges) {
        const A = XtX.map((row, i) => row.map((v, j) => v + (i === j ? Math.max(ridge, 1e-9) * n : 0)));
        const Ainv = invertMatrix(A);
        if (!Ainv) continue;
        const w = matMul(Ainv, matMul(Xt, Tc)); // p x 2
        const resid = X.map((x, i) => [Tc[i]![0]! - dot(x, w, 0), Tc[i]![1]! - dot(x, w, 1)]);
        let train = 0;
        for (const r of resid) train += Math.hypot(r[0]! * screen.width, r[1]! * screen.height);
        train /= n;
        // group leave-one-out
        const XA = matMul(X, Ainv); // n x p
        let loo = 0;
        let ok = true;
        for (const g of groups) {
          const m = g.length;
          const M: number[][] = [];
          for (let a = 0; a < m; a++) {
            const row: number[] = [];
            for (let c = 0; c < m; c++) {
              let h = 1 / n;
              const xa = XA[g[a]!]!;
              const xc = X[g[c]!]!;
              for (let k = 0; k < p; k++) h += xa[k]! * xc[k]!;
              row.push((a === c ? 1 : 0) - h);
            }
            M.push(row);
          }
          const Minv = invertMatrix(M);
          if (!Minv) { ok = false; break; }
          const rg = g.map((i) => resid[i]!);
          const loores = matMul(Minv, rg);
          for (const r of loores) loo += Math.hypot(r[0]! * screen.width, r[1]! * screen.height);
        }
        if (!ok) continue;
        loo /= n;
        if (!Number.isFinite(loo)) continue;
        // strict improvement needed (candidates ordered simplest first) so ties keep the simpler model
        if (!best || loo < best.loo * 0.999) {
          best = { loo, train, model: { degree, ridge, m1, s1, m2, s2, w, b: { x: tMean[0]!, y: tMean[1]! } } };
        }
      }
    }
    if (!best) {
      this.model = null;
      this.lastFit = { ok: false, samples: n, looErrorPx: Infinity, trainErrorPx: Infinity };
      return this.lastFit;
    }
    this.model = best.model;
    this.lastFit = { ok: true, samples: n, looErrorPx: best.loo, trainErrorPx: best.train };
    return this.lastFit;
  }

  /** Normalized 0..1 screen point (NOT clamped, NOT smoothed); null if not fitted or feature length mismatch. */
  predict(frame: GazeFrame): Vec2 | null {
    const m = this.model;
    if (!m || frame.features.length !== m.m1.length) return null;
    const z = frame.features.map((v, j) => (v - m.m1[j]!) / m.s1[j]!);
    const e = expand(z, m.degree).map((v, j) => (v - m.m2[j]!) / m.s2[j]!);
    const x = m.b.x + dot(e, m.w, 0);
    const y = m.b.y + dot(e, m.w, 1);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  toJSON(): unknown {
    return { version: 1, opts: this.opts, screen: this.screen, samples: this.samples, model: this.model, lastFit: this.lastFit };
  }

  static fromJSON(j: unknown): GazeCalibration {
    const o = (j ?? {}) as { opts?: { ridge?: number; degree?: 1 | 2 }; screen?: ScreenSize | null; samples?: Sample[]; model?: Model | null; lastFit?: FitResult | null };
    const c = new GazeCalibration(o.opts);
    c.samples = Array.isArray(o.samples) ? o.samples : [];
    c.model = o.model ?? null;
    c.screen = o.screen ?? null;
    c.lastFit = o.lastFit ?? null;
    return c;
  }
}

function dot(x: number[], w: number[][], col: 0 | 1): number {
  let s = 0;
  for (let k = 0; k < x.length; k++) s += x[k]! * w[k]![col]!;
  return s;
}
