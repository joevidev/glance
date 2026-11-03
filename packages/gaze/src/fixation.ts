import type { Vec2 } from './types';

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Fixation / saccade classifier with microsaccade suppression, in PIXELS (feed it screen px, not normalized units).
 *
 * While the gaze fixates, the output is the per-axis running median of the raw samples of the last `windowMs`
 * (default 200 ms), so jitter around the fixation point is flattened without a low-pass lag. A saccade is detected
 * when `confirm` consecutive samples (default 2) are all farther than `saccadePx` (default 100) from that median:
 * the window is then restarted from those samples, so the output jumps to the new location after `confirm` frames
 * (instead of dragging through a filter). One isolated far sample (a bad iris frame) never moves the output.
 */
export class FixationFilter {
  readonly windowMs: number;
  readonly saccadePx: number;
  readonly confirm: number;
  private buf: { ts: number; p: Vec2 }[] = [];
  private cand: { ts: number; p: Vec2 }[] = [];
  private out: Vec2 | null = null;

  constructor(opts?: { windowMs?: number; saccadePx?: number; confirm?: number }) {
    this.windowMs = opts?.windowMs ?? 200;
    this.saccadePx = opts?.saccadePx ?? 100;
    this.confirm = Math.max(1, opts?.confirm ?? 2);
  }

  reset(): void {
    this.buf = [];
    this.cand = [];
    this.out = null;
  }

  /** True while the last output was the median of a settled window (not a fresh saccade). */
  get fixating(): boolean {
    return this.buf.length >= this.confirm + 1;
  }

  /** Forget samples newer than `ms` ms before the newest one (e.g. the garbage frames just before a blink was detected). */
  dropRecent(ms: number): void {
    const newest = this.buf[this.buf.length - 1]?.ts;
    if (newest === undefined) return;
    const keep = this.buf.filter((h) => newest - h.ts > ms);
    if (keep.length > 0) this.buf = keep;
    this.cand = [];
  }

  private med(list: { p: Vec2 }[]): Vec2 {
    return { x: median(list.map((h) => h.p.x)), y: median(list.map((h) => h.p.y)) };
  }

  filter(p: Vec2, tsMs: number): Vec2 {
    if (this.buf.length === 0) {
      this.buf = [{ ts: tsMs, p: { ...p } }];
      this.out = { ...p };
      return { ...p };
    }
    const m = this.med(this.buf);
    if (Math.hypot(p.x - m.x, p.y - m.y) > this.saccadePx) {
      this.cand.push({ ts: tsMs, p: { ...p } });
      if (this.cand.length >= this.confirm) {
        this.buf = this.cand.slice(-this.confirm);
        this.cand = [];
        this.out = this.med(this.buf);
      } else {
        this.out = m; // not yet sure: hold
      }
      return { ...this.out! };
    }
    this.cand = [];
    this.buf.push({ ts: tsMs, p: { ...p } });
    while (this.buf.length > 1 && tsMs - this.buf[0]!.ts > this.windowMs) this.buf.shift();
    this.out = this.med(this.buf);
    return { ...this.out };
  }
}

/**
 * Dead zone with a trailing anchor, in px: the emitted point only moves once the input leaves a radius around it, and then
 * trails the input at that radius so leaving the zone does not make the cursor jump.
 */
export class DeadZone {
  private a: Vec2 | null = null;
  constructor(readonly radiusPx = 30) {}
  reset(): void {
    this.a = null;
  }
  get anchor(): Vec2 | null {
    return this.a ? { ...this.a } : null;
  }
  apply(p: Vec2): Vec2 {
    if (!this.a) {
      this.a = { ...p };
      return { ...p };
    }
    const dx = p.x - this.a.x;
    const dy = p.y - this.a.y;
    const d = Math.hypot(dx, dy);
    if (d > this.radiusPx) {
      this.a = { x: p.x - (dx / d) * this.radiusPx, y: p.y - (dy / d) * this.radiusPx };
    }
    return { ...this.a };
  }
}
