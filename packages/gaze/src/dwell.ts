import type { Vec2 } from './types';

/**
 * Dwell detector: progress 0..1 while the point stays within `radiusPx` of the running center of the
 * dwell; `fired` is true on the single update where progress reaches 1. It will not fire again until the
 * point leaves the radius (or reset()). It only reports; the app decides what a dwell means.
 */
export class DwellDetector {
  private readonly radiusPx: number;
  private readonly dwellMs: number;
  private start = 0;
  private n = 0;
  private cx = 0;
  private cy = 0;
  private lastTs = 0;
  private latched = false;

  constructor(opts?: { radiusPx?: number; dwellMs?: number }) {
    this.radiusPx = opts?.radiusPx ?? 70;
    this.dwellMs = opts?.dwellMs ?? 900;
  }

  reset(): void {
    this.n = 0;
    this.latched = false;
  }

  update(pointPx: Vec2, tsMs: number): { progress: number; fired: boolean; center: Vec2 | null } {
    if (!Number.isFinite(pointPx.x) || !Number.isFinite(pointPx.y)) {
      this.reset();
      return { progress: 0, fired: false, center: null };
    }
    const gap = tsMs - this.lastTs > 700 || tsMs < this.lastTs;
    this.lastTs = tsMs;
    if (this.n === 0 || gap || Math.hypot(pointPx.x - this.cx, pointPx.y - this.cy) > this.radiusPx) {
      this.n = 1;
      this.cx = pointPx.x;
      this.cy = pointPx.y;
      this.start = tsMs;
      this.latched = false;
      return { progress: 0, fired: false, center: { x: this.cx, y: this.cy } };
    }
    this.n++;
    this.cx += (pointPx.x - this.cx) / this.n;
    this.cy += (pointPx.y - this.cy) / this.n;
    const progress = Math.min(1, (tsMs - this.start) / this.dwellMs);
    let fired = false;
    if (progress >= 1 && !this.latched) {
      this.latched = true;
      fired = true;
    }
    return { progress, fired, center: { x: this.cx, y: this.cy } };
  }
}
