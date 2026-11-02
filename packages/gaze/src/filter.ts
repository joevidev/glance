import type { Vec2 } from './types';

/**
 * One Euro filter (Casiez, Roussel, Vogel, CHI 2012) for 2D points, using the vector speed so both axes
 * share one cutoff. Defaults are tuned for ~30 fps webcam gaze in NORMALIZED screen units (0..1):
 *   minCutoff 0.5 Hz  strong smoothing while fixating (jitter of a few % of the screen is flattened),
 *   beta 4            cutoff rises by 4 Hz per (screen-width/second) of speed, so saccades pass with little lag,
 *   dCutoff 1 Hz      smoothing of the speed estimate.
 * If you feed pixels instead, divide beta by the screen size.
 */
export class OneEuroFilter2D {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private x: Vec2 | null = null;
  private raw: Vec2 | null = null;
  private d: Vec2 = { x: 0, y: 0 };
  private ts = 0;

  constructor(opts?: { minCutoff?: number; beta?: number; dCutoff?: number }) {
    this.minCutoff = opts?.minCutoff ?? 0.5;
    this.beta = opts?.beta ?? 4;
    this.dCutoff = opts?.dCutoff ?? 1;
  }

  reset(): void {
    this.x = null;
    this.raw = null;
    this.d = { x: 0, y: 0 };
  }

  filter(p: Vec2, tsMs: number): Vec2 {
    if (!this.x || !this.raw) {
      this.x = { ...p };
      this.raw = { ...p };
      this.ts = tsMs;
      return { ...p };
    }
    let dt = (tsMs - this.ts) / 1000;
    if (!(dt > 0)) return { ...this.x }; // duplicate or out-of-order timestamp
    dt = Math.min(Math.max(dt, 1 / 240), 0.25);
    this.ts = tsMs;
    const aD = alpha(this.dCutoff, dt);
    const dx = (p.x - this.raw.x) / dt;
    const dy = (p.y - this.raw.y) / dt;
    this.d = { x: this.d.x + aD * (dx - this.d.x), y: this.d.y + aD * (dy - this.d.y) };
    const speed = Math.hypot(this.d.x, this.d.y);
    const a = alpha(this.minCutoff + this.beta * speed, dt);
    this.x = { x: this.x.x + a * (p.x - this.x.x), y: this.x.y + a * (p.y - this.x.y) };
    this.raw = { ...p };
    return { ...this.x };
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
