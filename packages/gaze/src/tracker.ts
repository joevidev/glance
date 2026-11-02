import type { GazeCalibration } from './calibration';
import { DwellDetector } from './dwell';
import { OneEuroFilter2D } from './filter';
import type { GazeFrame, ScreenSize, Vec2 } from './types';

export type TrackerUpdate = {
  /** Smoothed normalized point (0..1, clamped), or null before calibration / with no usable frame yet. */
  point: Vec2 | null;
  speedPxPerS: number;
  /** Same point in pixels. */
  pointPx: Vec2 | null;
  /** Dwell state at pointPx. Only a report; the app decides whether a dwell clicks. */
  dwell: { progress: number; fired: boolean; center: Vec2 | null };
  /** True when the point was frozen because an eye is closing/closed. */
  held: boolean;
};

/**
 * Calibration + One Euro smoothing + dwell. While either eye is closing (blink score above `holdBlink`,
 * default 0.4) the point is frozen, because the iris landmarks are garbage then and a wink would otherwise
 * drag the cursor off the target. The eyelid motion starts a little before the score crosses the threshold,
 * so for click-on-wink use recentPoint(~350) (where the gaze was a moment ago) rather than the live point.
 */
export class GazeTracker {
  readonly dwell: DwellDetector;
  private readonly filter: OneEuroFilter2D;
  private readonly holdBlink: number;
  private last: Vec2 | null = null;
  private lastTs: number | null = null;
  private speed = 0;
  private hist: { ts: number; p: Vec2 }[] = [];
  private newestTs = 0;
  private lastDwell: { progress: number; fired: boolean; center: Vec2 | null } = { progress: 0, fired: false, center: null };

  constructor(
    private readonly calib: GazeCalibration,
    private readonly screen: ScreenSize,
    opts?: { filter?: { minCutoff?: number; beta?: number; dCutoff?: number }; dwell?: { radiusPx?: number; dwellMs?: number }; holdBlink?: number },
  ) {
    this.filter = new OneEuroFilter2D(opts?.filter);
    this.dwell = new DwellDetector(opts?.dwell);
    this.holdBlink = opts?.holdBlink ?? 0.4;
  }

  reset(): void {
    this.filter.reset();
    this.dwell.reset();
    this.last = null;
    this.lastTs = null;
    this.speed = 0;
    this.hist = [];
    this.lastDwell = { progress: 0, fired: false, center: null };
  }

  update(frame: GazeFrame): TrackerUpdate {
    const px = (p: Vec2 | null): Vec2 | null => (p ? { x: p.x * this.screen.width, y: p.y * this.screen.height } : null);
    this.newestTs = frame.tsMs;
    if (Math.max(frame.blinkLeft, frame.blinkRight) > this.holdBlink && this.last) {
      // dwell does not advance (and cannot fire) while an eye is closing: a wink must not also complete a dwell
      return { point: { ...this.last }, speedPxPerS: 0, pointPx: px(this.last), dwell: { ...this.lastDwell, fired: false }, held: true };
    }
    const raw = this.calib.predict(frame);
    if (!raw) return { point: null, speedPxPerS: 0, pointPx: null, dwell: { progress: 0, fired: false, center: null }, held: false };
    if (this.lastTs !== null && frame.tsMs - this.lastTs > 700) {
      this.filter.reset();
      this.speed = 0;
    }
    const clamped = { x: Math.min(1, Math.max(0, raw.x)), y: Math.min(1, Math.max(0, raw.y)) };
    const p = this.filter.filter(clamped, frame.tsMs);
    if (this.last && this.lastTs !== null) {
      const dt = (frame.tsMs - this.lastTs) / 1000;
      if (dt > 0) {
        const inst = Math.hypot((p.x - this.last.x) * this.screen.width, (p.y - this.last.y) * this.screen.height) / dt;
        this.speed += (inst - this.speed) * Math.min(1, dt / 0.1);
      }
    }
    this.last = p;
    this.lastTs = frame.tsMs;
    this.hist.push({ ts: frame.tsMs, p });
    while (this.hist.length > 0 && frame.tsMs - this.hist[0]!.ts > 3000) this.hist.shift();
    this.lastDwell = this.dwell.update(px(p)!, frame.tsMs);
    return { point: { ...p }, speedPxPerS: this.speed, pointPx: px(p), dwell: this.lastDwell, held: false };
  }

  /** Smoothed point from about `msAgo` ms before the newest frame (null if no history). */
  recentPoint(msAgo: number): Vec2 | null {
    const target = this.newestTs - msAgo;
    let best: { ts: number; p: Vec2 } | null = null;
    for (const h of this.hist) {
      if (h.ts <= target) best = h;
      else break;
    }
    const h = best ?? this.hist[0];
    return h ? { ...h.p } : null;
  }
}
