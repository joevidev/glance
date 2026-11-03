import { assembleFeatures } from './features';
import { createRng } from './rng';
import type { GazeFrame, Vec2 } from './types';

export type SimScriptEvent = {
  /** Time from the start of the simulation. */
  atMs: number;
  kind: 'blink' | 'winkLeft' | 'winkRight' | 'mouthOpen' | 'browsUp';
  /** How long the expression is held (default: blink 150, wink 300, mouthOpen 800, browsUp 800). */
  durationMs?: number;
};

export type SimOptions = {
  fps?: number; // default 30
  /** How long each path point is looked at (default 1200 ms), including the saccade. */
  msPerPoint?: number;
  saccadeMs?: number; // default 90
  /** Multiplies all noise (default 1). 0 = clean. */
  noise?: number;
  seed?: number; // default 1
  startMs?: number; // default 0
  script?: SimScriptEvent[];
  /** Mean time between natural two-eye blinks, ms. 0/undefined = none. */
  naturalBlinkEveryMs?: number;
  /** Multiplies only the slow head wobble (default 1). 0 = still head, so iris noise is the only error source. */
  headWobble?: number;
};

const DEFAULT_HOLD: Record<SimScriptEvent['kind'], number> = { blink: 150, winkLeft: 300, winkRight: 300, mouthOpen: 800, browsUp: 800 };

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 0..1 envelope: 60 ms ramp up, hold, 60 ms ramp down. */
function envelope(t: number, at: number, hold: number): number {
  const ramp = 60;
  if (t < at || t > at + hold + 2 * ramp) return 0;
  if (t < at + ramp) return (t - at) / ramp;
  if (t <= at + ramp + hold) return 1;
  return 1 - (t - at - ramp - hold) / ramp;
}

/**
 * Synthetic gaze frames for a target path, so the app can be developed without a camera. The true
 * mapping is a smooth, mildly nonlinear function of the target (iris offset about +-0.1 across the screen,
 * a little head yaw/pitch following the target), plus Gaussian noise (about 2% of the screen after
 * calibration), slow head wobble, and optional scripted blinks/winks/mouth/brows. Deterministic per seed.
 * `targets[i]` is the true screen target (normalized) that `frames[i]` was generated for.
 */
export function simulateGaze(path: Vec2[], opts?: SimOptions): { frames: GazeFrame[]; targets: Vec2[] } {
  const fps = opts?.fps ?? 30;
  const msPer = opts?.msPerPoint ?? 1200;
  const sacc = opts?.saccadeMs ?? 90;
  const noise = opts?.noise ?? 1;
  const hw = opts?.headWobble ?? 1;
  const start = opts?.startMs ?? 0;
  const rng = createRng(opts?.seed ?? 1);
  const script = [...(opts?.script ?? [])];
  if (opts?.naturalBlinkEveryMs && opts.naturalBlinkEveryMs > 0) {
    const total = path.length * msPer;
    let t = opts.naturalBlinkEveryMs * (0.5 + rng.next());
    while (t < total) {
      script.push({ atMs: t, kind: 'blink', durationMs: 60 + rng.next() * 60 });
      t += opts.naturalBlinkEveryMs * (0.5 + rng.next());
    }
  }
  const frames: GazeFrame[] = [];
  const targets: Vec2[] = [];
  if (path.length === 0) return { frames, targets };
  const total = path.length * msPer;
  const dtMs = 1000 / fps;
  let wobX = 0, wobY = 0; // slow AR(1) head wobble
  for (let t = 0; t < total; t += dtMs) {
    const idx = Math.min(path.length - 1, Math.floor(t / msPer));
    const cur = path[idx]!;
    const prev = path[Math.max(0, idx - 1)]!;
    const k = smooth((t - idx * msPer) / sacc);
    const tx = prev.x + (cur.x - prev.x) * k;
    const ty = prev.y + (cur.y - prev.y) * k;
    wobX = 0.98 * wobX + 0.02 * rng.gauss() * noise * hw;
    wobY = 0.98 * wobY + 0.02 * rng.gauss() * noise * hw;

    const yaw = 0.18 * (tx - 0.5) + wobX;
    const pitch = 0.10 * (ty - 0.5) + wobY;
    const roll = 0.5 * wobX;
    const nIris = 0.004 * noise;
    const gx = 0.2 * (tx - 0.5) + 0.03 * (tx - 0.5) ** 3 - 0.15 * yaw;
    const gy = 0.07 * (ty - 0.5) + 0.01 * (ty - 0.5) ** 2 + 0.05 * pitch;
    const open0 = 0.3 - 0.05 * (ty - 0.5);

    let bl = 0, br = 0, jaw = 0, brow = 0;
    for (const e of script) {
      const hold = e.durationMs ?? DEFAULT_HOLD[e.kind];
      const v = envelope(t, e.atMs, hold);
      if (v === 0) continue;
      if (e.kind === 'blink') { bl = Math.max(bl, v); br = Math.max(br, v); }
      else if (e.kind === 'winkLeft') { bl = Math.max(bl, v); br = Math.max(br, 0.1 * v); }
      else if (e.kind === 'winkRight') { br = Math.max(br, v); bl = Math.max(bl, 0.1 * v); }
      else if (e.kind === 'mouthOpen') jaw = Math.max(jaw, 0.7 * v);
      else brow = Math.max(brow, 0.75 * v);
    }
    const eyeNoise = (closing: number) => nIris * (1 + 12 * closing);
    const eye = (closing: number, dx: number) => ({
      ix: gx + dx + eyeNoise(closing) * rng.gauss(),
      iy: gy + eyeNoise(closing) * rng.gauss(),
      ly: gy - 0.02 + eyeNoise(closing) * rng.gauss(),
      open: Math.max(0, open0 * (1 - closing)) + 0.003 * noise * rng.gauss(),
    });
    const features = assembleFeatures({
      eyeA: eye(br, -0.004), // eye A = user's right eye
      eyeB: eye(bl, 0.004),
      yaw, pitch, roll,
      cx: 0.5 + 0.3 * wobX,
      cy: 0.5 + 0.3 * wobY,
      size: 0.32 + 0.02 * wobX,
    });
    const j = (s: number) => Math.min(1, Math.max(0, s + 0.01 * noise * rng.gauss()));
    frames.push({
      tsMs: start + t,
      features,
      blinkLeft: bl === 0 ? j(0.02) : j(bl),
      blinkRight: br === 0 ? j(0.02) : j(br),
      jawOpen: jaw === 0 ? j(0.02) : j(jaw),
      browUp: brow === 0 ? j(0.03) : j(brow),
      head: { yaw, pitch, roll },
      faceBox: { cx: 0.5 + 0.3 * wobX, cy: 0.5 + 0.3 * wobY, size: 0.32 + 0.02 * wobX },
    });
    targets.push({ x: tx, y: ty });
  }
  return { frames, targets };
}

/** Frames only; see simulateGaze for the matching ground-truth targets. */
export function simulateGazeFrames(path: Vec2[], opts?: SimOptions): GazeFrame[] {
  return simulateGaze(path, opts).frames;
}
