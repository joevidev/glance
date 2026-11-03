import type { GazeFrame } from './types';

export type GestureEvent =
  | { type: 'wink_left' | 'wink_right' | 'double_wink_left' | 'double_wink_right' | 'brows_up' | 'mouth_open_start' | 'mouth_open_end' | 'eyes_closed_long'; tsMs: number }
  | { type: 'scroll'; tsMs: number; velocity: number };

export type GestureThresholds = {
  /** Eye counts as closed at or above this blink score. */
  blinkClosed: number;
  /** ...and as open again at or below this (hysteresis; must be < blinkClosed). */
  blinkOpen: number;
  /** A one-eye closure shorter than this is not a wink. */
  winkMinMs: number;
  /** ...longer than this is not a wink either (deliberate hold, fatigue, squint). */
  winkMaxMs: number;
  /** Second wink of the same eye must START within this long after the first one ENDED. */
  doubleWinkGapMs: number;
  /** jawOpen at or above this starts "mouth open". */
  mouthOpen: number;
  /** jawOpen at or below this ends it. */
  mouthClose: number;
  /** browUp at or above this (held 100 ms) raises "brows up"; released at 60% of it. */
  browsUp: number;
  /** Scroll velocity in px/s per rad/s of head pitch rate while brows are up (+ down). Negative flips direction. */
  scrollGain: number;
  /** Both eyes held closed this long fires "eyes_closed_long" (opens the radial menu). Natural blinks are ~100-150 ms, so 700 is deliberate. Old saved profiles lack it and get this default. */
  eyesClosedLongMs: number;
};

export const DEFAULT_THRESHOLDS: GestureThresholds = {
  blinkClosed: 0.6,
  blinkOpen: 0.35,
  winkMinMs: 200,
  winkMaxMs: 700,
  doubleWinkGapMs: 500,
  mouthOpen: 0.5,
  mouthClose: 0.25,
  browsUp: 0.5,
  scrollGain: 1200,
  eyesClosedLongMs: 700,
};
/** Both eyes may flicker open for up to this long (landmarker noise on a closed lid) without restarting the long-close timer. */
const EYES_GAP_MS = 150;
/** A hole in the frame stream longer than this restarts the long-close timer (we cannot know the eyes stayed closed). */
const EYES_FRAME_GAP_MS = 300;

const BROW_HOLD_MS = 100;
const BROW_RELEASE = 0.6;
const SCROLL_DEADZONE = 0.12; // rad/s of filtered pitch rate (about 7 deg/s)
const SCROLL_MAX = 4000;
const PITCH_TAU_S = 0.06;

type Eye = 'left' | 'right';

/**
 * Stateless-input gesture detector: feed every frame in order. Events (all timestamps are frame times):
 *
 * - wink_left / wink_right (user's left/right eye): one eye closed >= blinkClosed for winkMinMs..winkMaxMs
 *   while the other stayed open; emitted when that eye REOPENS. Natural blinks never fire: a frame with both
 *   eyes closed poisons the candidate and nothing can arm again until both eyes are open (which also covers
 *   the one-frame skew at the end of a blink).
 * - double_wink_*: a second wink of the same eye starting within doubleWinkGapMs of the first one's end. It is
 *   emitted INSTEAD of the second wink_* (the first wink_* was already emitted); the next wink starts over.
 * - eyes_closed_long: BOTH eyes closed continuously for eyesClosedLongMs (default 700; flicker up to 150 ms
 *   tolerated); emitted ONCE, at the moment the time is reached while the eyes are still closed. Re-arms only
 *   after both eyes are open again. A one-eye closure never fires it, a natural blink (~150 ms) is far below it.
 * - brows_up: browUp held >= browsUp for 100 ms; re-arms below 60% of the threshold.
 * - scroll: while brows are up, every frame with |head pitch rate| beyond a small dead zone. velocity px/s,
 *   + = down (nodding down), - = up.
 * - mouth_open_start / mouth_open_end: jawOpen hysteresis (mouthOpen / mouthClose).
 */
export class GestureDetector {
  private readonly th: GestureThresholds;
  private closed: Record<Eye, boolean> = { left: false, right: false };
  private poisoned = false;
  private cand: { eye: Eye; start: number; valid: boolean } | null = null;
  private lastWink: { eye: Eye; end: number } | null = null;
  private bothSince: number | null = null;
  private bothFired = false;
  private bothGapSince: number | null = null;
  private prevT: number | null = null;
  private mouthOpen = false;
  private browsEngaged = false;
  private browPending: number | null = null;
  private pitch: number | null = null;
  private lastTs: number | null = null;

  constructor(thresholds?: Partial<GestureThresholds>) {
    this.th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  reset(): void {
    this.closed = { left: false, right: false };
    this.poisoned = false;
    this.cand = null;
    this.lastWink = null;
    this.bothSince = null;
    this.bothFired = false;
    this.bothGapSince = null;
    this.prevT = null;
    this.mouthOpen = false;
    this.browsEngaged = false;
    this.browPending = null;
    this.pitch = null;
    this.lastTs = null;
  }

  update(frame: GazeFrame): GestureEvent[] {
    const ev: GestureEvent[] = [];
    const t = frame.tsMs;
    const th = this.th;

    // ---- eyes / winks
    const was = { ...this.closed };
    const next: Record<Eye, boolean> = {
      left: hyst(was.left, frame.blinkLeft, th.blinkClosed, th.blinkOpen),
      right: hyst(was.right, frame.blinkRight, th.blinkClosed, th.blinkOpen),
    };
    this.closed = next;
    if (next.left && next.right) {
      this.poisoned = true;
      this.cand = null;
    } else if (!next.left && !next.right) {
      this.poisoned = false;
    }
    if (this.cand && t - this.cand.start > th.winkMaxMs) this.cand.valid = false;

    for (const eye of ['left', 'right'] as const) {
      const other: Eye = eye === 'left' ? 'right' : 'left';
      if (was[eye] && !next[eye]) {
        const c = this.cand;
        if (c && c.eye === eye) {
          const dur = t - c.start;
          if (c.valid && dur >= th.winkMinMs && dur <= th.winkMaxMs) {
            const lw = this.lastWink;
            if (lw && lw.eye === eye && c.start - lw.end <= th.doubleWinkGapMs) {
              ev.push({ type: eye === 'left' ? 'double_wink_left' : 'double_wink_right', tsMs: t });
              this.lastWink = null;
            } else {
              ev.push({ type: eye === 'left' ? 'wink_left' : 'wink_right', tsMs: t });
              this.lastWink = { eye, end: t };
            }
          }
          this.cand = null;
        }
      } else if (!was[eye] && next[eye]) {
        if (!this.poisoned && !next[other] && this.cand === null) this.cand = { eye, start: t, valid: true };
      }
    }

    // ---- long both-eyes close
    if (this.prevT !== null && t - this.prevT > EYES_FRAME_GAP_MS) {
      this.bothSince = null;
      this.bothGapSince = null;
      if (!(next.left || next.right)) this.bothFired = false;
    }
    this.prevT = t;
    if (next.left && next.right) {
      this.bothGapSince = null;
      if (this.bothSince === null) this.bothSince = t;
      if (!this.bothFired && t - this.bothSince >= th.eyesClosedLongMs) {
        this.bothFired = true;
        ev.push({ type: 'eyes_closed_long', tsMs: t });
      }
    } else if (!next.left && !next.right) {
      this.bothSince = null;
      this.bothGapSince = null;
      this.bothFired = false;
    } else if (this.bothSince !== null && !this.bothFired) {
      // one eye reopened: tolerate a short flicker, otherwise this is not a deliberate both-eyes close
      if (this.bothGapSince === null) this.bothGapSince = t;
      if (t - this.bothGapSince > EYES_GAP_MS) {
        this.bothSince = null;
        this.bothGapSince = null;
      }
    }

    // ---- mouth
    if (!this.mouthOpen && frame.jawOpen >= th.mouthOpen) {
      this.mouthOpen = true;
      ev.push({ type: 'mouth_open_start', tsMs: t });
    } else if (this.mouthOpen && frame.jawOpen <= th.mouthClose) {
      this.mouthOpen = false;
      ev.push({ type: 'mouth_open_end', tsMs: t });
    }

    // ---- brows
    if (frame.browUp >= th.browsUp) {
      if (this.browPending === null) this.browPending = t;
      if (!this.browsEngaged && t - this.browPending >= BROW_HOLD_MS) {
        this.browsEngaged = true;
        ev.push({ type: 'brows_up', tsMs: t });
      }
    } else if (frame.browUp <= th.browsUp * BROW_RELEASE) {
      this.browPending = null;
      this.browsEngaged = false;
    }

    // ---- scroll from head pitch rate (pitch always tracked so the first engaged frame has a rate)
    const dt = this.lastTs === null ? 0 : (t - this.lastTs) / 1000;
    if (this.pitch === null || dt <= 0) {
      if (this.pitch === null) this.pitch = frame.head.pitch;
    } else {
      const a = dt / (PITCH_TAU_S + dt);
      const prev = this.pitch;
      this.pitch = prev + a * (frame.head.pitch - prev);
      const rate = (this.pitch - prev) / dt;
      if (this.browsEngaged && Math.abs(rate) > SCROLL_DEADZONE) {
        const v = th.scrollGain * Math.sign(rate) * (Math.abs(rate) - SCROLL_DEADZONE);
        ev.push({ type: 'scroll', tsMs: t, velocity: Math.max(-SCROLL_MAX, Math.min(SCROLL_MAX, v)) });
      }
    }
    if (dt > 0 || this.lastTs === null) this.lastTs = t;
    return ev;
  }
}

function hyst(prev: boolean, v: number, hi: number, lo: number): boolean {
  if (prev) return v > lo;
  return v >= hi;
}

export type GestureName = 'winkLeft' | 'winkRight' | 'mouthOpen' | 'browsUp' | 'eyesClosed';

const percentile = (a: number[], q: number): number => {
  if (a.length === 0) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Sig = { bl: number[]; br: number[]; jaw: number[]; brow: number[] };
const emptySig = (): Sig => ({ bl: [], br: [], jaw: [], brow: [] });
const push = (s: Sig, f: GazeFrame) => {
  s.bl.push(f.blinkLeft);
  s.br.push(f.blinkRight);
  s.jaw.push(f.jawOpen);
  s.brow.push(f.browUp);
};

/**
 * Measures THIS user. Feed neutral-face frames (relaxed, natural blinks allowed) and frames of each
 * gesture held/performed a few times. result() returns personalized thresholds and which gestures are
 * usable: `works` is false when the gesture does not separate enough from neutral (or, for winks, when the
 * other eye cannot be kept open). Gestures that do not work keep default thresholds; the app should leave
 * them unbound. `separation` is the measured gap (0..1) for display.
 */
export class GestureCalibrator {
  private neutral = emptySig();
  private g: Record<GestureName, Sig> = { winkLeft: emptySig(), winkRight: emptySig(), mouthOpen: emptySig(), browsUp: emptySig(), eyesClosed: emptySig() };

  addNeutral(frame: GazeFrame): void { push(this.neutral, frame); }
  addGesture(name: GestureName, frame: GazeFrame): void { push(this.g[name], frame); }

  result(): { thresholds: GestureThresholds; works: Record<GestureName, boolean>; separation: Record<GestureName, number> } {
    const T = { ...DEFAULT_THRESHOLDS };
    const nBlinkHi = Math.max(percentile(this.neutral.bl, 0.9), percentile(this.neutral.br, 0.9));
    const nJaw = percentile(this.neutral.jaw, 0.9);
    const nBrow = percentile(this.neutral.brow, 0.9);
    const works = { winkLeft: false, winkRight: false, mouthOpen: false, browsUp: false, eyesClosed: false };
    const separation = { winkLeft: 0, winkRight: 0, mouthOpen: 0, browsUp: 0, eyesClosed: 0 };

    const wl = this.g.winkLeft;
    const wr = this.g.winkRight;
    const lvlL = percentile(wl.bl, 0.75);
    const othL = percentile(wl.br, 0.75);
    const lvlR = percentile(wr.br, 0.75);
    const othR = percentile(wr.bl, 0.75);
    separation.winkLeft = wl.bl.length ? Math.min(lvlL - nBlinkHi, lvlL - othL) : 0;
    separation.winkRight = wr.br.length ? Math.min(lvlR - nBlinkHi, lvlR - othR) : 0;
    works.winkLeft = separation.winkLeft >= 0.3;
    works.winkRight = separation.winkRight >= 0.3;
    const refs: number[] = [];
    if (works.winkLeft) refs.push(lvlL);
    if (works.winkRight) refs.push(lvlR);
    if (refs.length) {
      const ref = Math.min(...refs);
      T.blinkClosed = clamp(nBlinkHi + 0.55 * (ref - nBlinkHi), 0.3, 0.85);
      T.blinkOpen = clamp(T.blinkClosed - 0.4 * (T.blinkClosed - nBlinkHi), nBlinkHi + 0.05, T.blinkClosed - 0.08);
    }

    const jawLevel = percentile(this.g.mouthOpen.jaw, 0.75);
    separation.mouthOpen = this.g.mouthOpen.jaw.length ? jawLevel - nJaw : 0;
    works.mouthOpen = separation.mouthOpen >= 0.25;
    if (works.mouthOpen) {
      T.mouthOpen = clamp(nJaw + 0.55 * separation.mouthOpen, 0.2, 0.8);
      T.mouthClose = clamp(T.mouthOpen - 0.4 * (T.mouthOpen - nJaw), nJaw + 0.03, T.mouthOpen - 0.08);
    }

    const browLevel = percentile(this.g.browsUp.brow, 0.75);
    separation.browsUp = this.g.browsUp.brow.length ? browLevel - nBrow : 0;
    works.browsUp = separation.browsUp >= 0.2;
    if (works.browsUp) T.browsUp = clamp(nBrow + 0.55 * separation.browsUp, 0.2, 0.85);

    // both eyes held closed: the WEAKER eye must clear the (possibly wink-derived) closed threshold with some margin
    const ec = this.g.eyesClosed;
    if (ec.bl.length) {
      const lvl = Math.min(percentile(ec.bl, 0.25), percentile(ec.br, 0.25));
      separation.eyesClosed = lvl - nBlinkHi;
      works.eyesClosed = separation.eyesClosed >= 0.3 && lvl >= T.blinkClosed + 0.05;
    }

    return { thresholds: T, works, separation };
  }
}
