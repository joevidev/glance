import type { GazeFrame, LandmarkerResultLike } from './types';

/**
 * Calibration feature vector (all values dimensionless or radians). Order is part of the contract:
 * the first POLY_CORE entries are the "core gaze" features that the degree-2 polynomial expands.
 *
 *  0 gx    mean over both eyes of iris offset ALONG the eye axis (corner to corner), relative to the
 *          corner midpoint, divided by eye width. Image-right positive. About -0.15..+0.15.
 *  1 gy    mean iris offset PERPENDICULAR to the eye axis (image-down positive), relative to the
 *          corner midpoint, divided by eye width. Roll-invariant because the axis follows the eye.
 *  2 gly   mean iris offset perpendicular to the axis relative to the CENTER OF THE LIDS
 *          (midpoint of upper and lower lid), divided by eye width. Adds vertical gaze that does not
 *          depend on where the corner line sits.
 *  3 yaw   head yaw, radians (+ nose toward image right).
 *  4 pitch head pitch, radians (+ looking down).
 *  5 roll  head roll, radians (+ clockwise in the image).
 *  6 cx    face bounding box center x, normalized 0..1 (head translation).
 *  7 cy    face bounding box center y, normalized 0..1.
 *  8 size  face bounding box size, normalized 0..1 (distance to camera).
 *  9 open  mean eyelid gap / eye width (eye openness; also drops when looking down).
 * 10 ixA   iris x offset of eye A (landmark 468, user's right eye, image-left), as gx.
 * 11 ixB   iris x offset of eye B (landmark 473, user's left eye, image-right), as gx.
 * 12 iyA   iris y offset of eye A (as gy).
 * 13 iyB   iris y offset of eye B (as gy).
 *
 * Landmarks: iris centers 468/473; eye corners 33/133 (eye A) and 362/263 (eye B); lids 159/145 (A)
 * and 386/374 (B). Eye axes are oriented image-left to image-right for both eyes so signs agree.
 * Landmark x is scaled by `aspect` (video width / height) so geometry is metric before ratios are taken.
 */
export const FEATURE_NAMES = [
  'gx', 'gy', 'gly', 'yaw', 'pitch', 'roll', 'cx', 'cy', 'size', 'open', 'ixA', 'ixB', 'iyA', 'iyB',
] as const;
export const FEATURE_COUNT = FEATURE_NAMES.length;
export const POLY_CORE = 5;

export type EyeMetrics = { ix: number; iy: number; ly: number; open: number };
export type FeatureParts = {
  eyeA: EyeMetrics;
  eyeB: EyeMetrics;
  yaw: number;
  pitch: number;
  roll: number;
  cx: number;
  cy: number;
  size: number;
};

export function assembleFeatures(p: FeatureParts): number[] {
  return [
    (p.eyeA.ix + p.eyeB.ix) / 2,
    (p.eyeA.iy + p.eyeB.iy) / 2,
    (p.eyeA.ly + p.eyeB.ly) / 2,
    p.yaw,
    p.pitch,
    p.roll,
    p.cx,
    p.cy,
    p.size,
    (p.eyeA.open + p.eyeB.open) / 2,
    p.eyeA.ix,
    p.eyeB.ix,
    p.eyeA.iy,
    p.eyeB.iy,
  ];
}

type LM = { x: number; y: number; z: number };
type P = { x: number; y: number };

const IDX = {
  irisA: 468, irisB: 473,
  ringA: [469, 470, 471, 472], ringB: [474, 475, 476, 477],
  cornerA1: 33, cornerA2: 133, cornerB1: 362, cornerB2: 263,
  upperA: 159, lowerA: 145, upperB: 386, lowerB: 374,
  noseTip: 1, chin: 152,
};

/**
 * Iris center from the center landmark plus the 4 ring landmarks (independent estimates of the same point, so the average has
 * less noise). x uses all five points. y uses the center and the two ring points nearest the horizontal midline only: the top and
 * bottom ring points are partly hidden by the lids, and averaging them would drag the estimate down when the eye is half closed.
 * Falls back to the center alone when the ring is missing or implausible (any ring point farther than 0.35 eye widths).
 */
function irisCenter(pt: (i: number) => P, iris: number, ring: number[], ux: number, uy: number, w: number): P {
  const c = pt(iris);
  const pts: { du: number; dv: number; p: P }[] = [];
  for (const r of ring) {
    const p = pt(r);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (Math.hypot(dx, dy) > 0.35 * w) return c;
    pts.push({ du: dx * ux + dy * uy, dv: -dx * uy + dy * ux, p });
  }
  if (pts.length < 4) return c;
  const side = [...pts].sort((a, b) => Math.abs(a.dv) - Math.abs(b.dv)).slice(0, 2);
  const x = (c.x + pts.reduce((a, q) => a + q.p.x, 0)) / 5;
  const y = (c.y + side.reduce((a, q) => a + q.p.y, 0)) / 3;
  return { x, y };
}

function eyeMetrics(pt: (i: number) => P, iris: number, ring: number[] | null, c1: number, c2: number, up: number, lo: number): EyeMetrics | null {
  const a = pt(c1);
  const b = pt(c2);
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const w = Math.hypot(ex, ey);
  if (!(w > 1e-6)) return null;
  const ux = ex / w;
  const uy = ey / w;
  const vx = -uy; // perpendicular, image-down positive when u points image-right
  const vy = ux;
  const ir = ring ? irisCenter(pt, iris, ring, ux, uy, w) : pt(iris);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const u = pt(up);
  const l = pt(lo);
  const lcx = (u.x + l.x) / 2;
  const lcy = (u.y + l.y) / 2;
  return {
    ix: ((ir.x - mx) * ux + (ir.y - my) * uy) / w,
    iy: ((ir.x - mx) * vx + (ir.y - my) * vy) / w,
    ly: ((ir.x - lcx) * vx + (ir.y - lcy) * vy) / w,
    open: ((l.x - u.x) * vx + (l.y - u.y) * vy) / w,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Head pose from MediaPipe's 4x4 column-major facial transformation matrix (camera space: x right,
 * y up, z toward the camera; the face looks along its local +z). Returns null if unusable.
 */
export function headPoseFromMatrix(data: ArrayLike<number>): { yaw: number; pitch: number; roll: number } | null {
  if (data.length < 16) return null;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(data[i])) return null;
  const g = (i: number) => data[i] as number;
  const fl = Math.hypot(g(8), g(9), g(10));
  const ul = Math.hypot(g(4), g(5), g(6));
  if (fl < 1e-9 || ul < 1e-9) return null;
  const fx = g(8) / fl, fy = g(9) / fl, fz = g(10) / fl;
  const ux = g(4) / ul, uy = g(5) / ul;
  return { yaw: Math.atan2(fx, fz), pitch: Math.atan2(-fy, fz), roll: Math.atan2(ux, uy) };
}

/** Rough fallback when the matrix is missing: roll from the eye line, yaw and pitch from the nose. */
function headPoseFromLandmarks(pt: (i: number) => P): { yaw: number; pitch: number; roll: number } {
  const a = pt(IDX.cornerA1);
  const b = pt(IDX.cornerB2);
  const roll = Math.atan2(b.y - a.y, b.x - a.x);
  const iod = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const nose = pt(IDX.noseTip);
  const chin = pt(IDX.chin);
  // rotate nose/chin into the roll-free frame
  const c = Math.cos(-roll), s = Math.sin(-roll);
  const rot = (p: P) => ({ x: (p.x - mid.x) * c - (p.y - mid.y) * s, y: (p.x - mid.x) * s + (p.y - mid.y) * c });
  const n = rot(nose);
  const ch = rot(chin);
  const yaw = Math.asin(clamp(n.x / (0.55 * iod), -1, 1));
  const ratio = ch.y > 1e-6 ? n.y / ch.y : 0.5;
  const pitch = (ratio - 0.5) * 1.5;
  return { yaw, pitch, roll };
}

/**
 * Turn a FaceLandmarker result into a GazeFrame. Returns null when there is no face or the mesh has
 * no iris landmarks (needs 478 points). `aspect` = video width / height (default 16/9).
 */
export function frameFromResult(r: LandmarkerResultLike, tsMs: number, opts?: { aspect?: number; irisRing?: boolean }): GazeFrame | null {
  const lm: LM[] | undefined = r.faceLandmarks?.[0];
  if (!lm || lm.length < 478) return null;
  const aspect = opts?.aspect && opts.aspect > 0 ? opts.aspect : 16 / 9;
  const pt = (i: number): P => {
    const l = lm[i]!;
    return { x: l.x * aspect, y: l.y };
  };
  const useRing = opts?.irisRing !== false;
  const eyeA = eyeMetrics(pt, IDX.irisA, useRing ? IDX.ringA : null, IDX.cornerA1, IDX.cornerA2, IDX.upperA, IDX.lowerA);
  const eyeB = eyeMetrics(pt, IDX.irisB, useRing ? IDX.ringB : null, IDX.cornerB1, IDX.cornerB2, IDX.upperB, IDX.lowerB);
  if (!eyeA || !eyeB) return null;

  const bs = new Map<string, number>();
  for (const c of r.faceBlendshapes?.[0]?.categories ?? []) bs.set(c.categoryName, c.score);
  const s = (name: string) => clamp(bs.get(name) ?? 0, 0, 1);

  const m = r.facialTransformationMatrixes?.[0]?.data;
  const head = (m ? headPoseFromMatrix(m) : null) ?? headPoseFromLandmarks(pt);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const l of lm) {
    if (l.x < minX) minX = l.x;
    if (l.x > maxX) maxX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.y > maxY) maxY = l.y;
  }
  const faceBox = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: Math.max(maxX - minX, maxY - minY) };

  const features = assembleFeatures({ eyeA, eyeB, ...head, cx: faceBox.cx, cy: faceBox.cy, size: faceBox.size });
  if (!features.every(Number.isFinite)) return null;

  return {
    tsMs,
    features,
    blinkLeft: s('eyeBlinkLeft'),
    blinkRight: s('eyeBlinkRight'),
    jawOpen: s('jawOpen'),
    browUp: Math.max(s('browInnerUp'), (s('browOuterUpLeft') + s('browOuterUpRight')) / 2),
    head,
    faceBox,
  };
}

/**
 * Short temporal median on the iris offset features (default: 0 gx, 1 gy, 2 gly, 10..13 per-eye iris offsets), window 3 frames.
 * Removes single-frame spikes (a mis-detected iris) at the cost of about one frame of lag on a step. Head and openness features
 * pass through untouched (openness must stay sharp so a blink is seen). Feed it every frame in order; a gap longer than `gapMs`
 * or a null frame (no face) restarts it. Use the same smoother for calibration and live frames.
 */
export class FeatureSmoother {
  private readonly win: number;
  private readonly idx: number[];
  private readonly gapMs: number;
  private hist: { ts: number; f: number[] }[] = [];

  constructor(opts?: { window?: number; indices?: number[]; gapMs?: number }) {
    this.win = Math.max(1, opts?.window ?? 3);
    this.idx = opts?.indices ?? [0, 1, 2, 10, 11, 12, 13];
    this.gapMs = opts?.gapMs ?? 300;
  }

  reset(): void {
    this.hist = [];
  }

  smooth(frame: GazeFrame | null): GazeFrame | null {
    if (!frame) {
      this.hist = [];
      return frame;
    }
    const last = this.hist[this.hist.length - 1];
    if (last && frame.tsMs - last.ts > this.gapMs) this.hist = [];
    this.hist.push({ ts: frame.tsMs, f: frame.features });
    while (this.hist.length > this.win) this.hist.shift();
    if (this.hist.length < 3) return frame;
    const f = frame.features.slice();
    for (const i of this.idx) {
      const v = this.hist.map((h) => h.f[i]!).sort((a, b) => a - b);
      f[i] = v[v.length >> 1]!;
    }
    return { ...frame, features: f };
  }
}
