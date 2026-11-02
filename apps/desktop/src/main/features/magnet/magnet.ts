// Cursor magnet (pure logic, no Electron): webcam gaze is 100-200 px off, so while the eyes FIXATE the cursor
// settles on the clickable element nearest the gaze instead of hovering between things. Saccades move it freely.
// The raw gaze is never modified here: this only returns the point the REAL cursor should be moved to.
export interface Pt {
  x: number
  y: number
}
export interface Box {
  x: number
  y: number
  w: number
  h: number
}
/** A candidate, box in global screen points. */
export interface MagnetElement {
  id: number
  box: Box
}
export interface MagnetParams {
  /** Smoothed gaze speed below this (px/s) counts as still. */
  fixSpeed: number
  /** Above this (px/s) it is a saccade: release the magnet at once. */
  saccadeSpeed: number
  /** Still for this long before a new snap is allowed. */
  fixMs: number
  /** Snap only to an element whose BOX is within this distance of the gaze. */
  snapRange: number
  /** Once snapped, stay until the gaze is farther than this from the box. */
  releaseRange: number
  /** Switch to another element only when it is closer by at least this much. */
  switchMargin: number
  /** The cursor is kept at least this far inside the box. */
  inset: number
  /** Per axis: boxes up to this size are targeted at the center, larger ones at the gaze point clamped inside. */
  centerMax: number
  /** Ignore boxes bigger than this fraction of the screen area (backgrounds, containers). */
  maxAreaFrac: number
  /** Time to cover ~90% of the way to the target (never a teleport). */
  easeMs: number
  /** Candidate list lifetime. */
  ttlMs: number
  /** A list fetched more than this before the fixation started is not trusted (the page may have scrolled). */
  preFixMs: number
  /** Minimum gap between two candidate refreshes. */
  minRefreshGapMs: number
}
export const DEFAULT_MAGNET: MagnetParams = {
  fixSpeed: 300,
  saccadeSpeed: 1000,
  fixMs: 200,
  snapRange: 70,
  releaseRange: 110,
  switchMargin: 25,
  inset: 6,
  centerMax: 120,
  maxAreaFrac: 0.4,
  easeMs: 80,
  ttlMs: 1500,
  preFixMs: 600,
  minRefreshGapMs: 400,
}
export interface MagnetCtx {
  enabled: boolean
  /** radial menu / drag / typing panel / confirm card: never snap. */
  blocked: boolean
  display: { width: number; height: number }
}

/** Distance from p to the box (0 inside). */
export function distToBox(p: Pt, b: Box): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w))
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h))
  return Math.hypot(dx, dy)
}

function axis(v: number, lo: number, size: number, p: MagnetParams): number {
  if (size <= p.centerMax) return lo + size / 2
  const inset = Math.min(p.inset, size / 2)
  return Math.min(Math.max(v, lo + inset), lo + size - inset)
}

/** The point inside the box the cursor settles on. */
export function snapPoint(raw: Pt, b: Box, p: MagnetParams = DEFAULT_MAGNET): Pt {
  return { x: axis(raw.x, b.x, b.w, p), y: axis(raw.y, b.y, b.h, p) }
}

const sameBox = (a: Box, b: Box, tol = 12) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol

export class MagnetCore {
  readonly p: MagnetParams
  private els: MagnetElement[] = []
  private fetchedAt = -Infinity
  private lastRefreshAt = -Infinity
  private prevRaw: Pt | null = null
  private lastT = 0
  private speed = 0
  private fixStart: number | null = null
  private snapped: MagnetElement | null = null
  private cur: Pt | null = null
  private hist: { ts: number; target: Pt; snapped: boolean }[] = []

  constructor(params: Partial<MagnetParams> = {}) {
    this.p = { ...DEFAULT_MAGNET, ...params }
  }

  setElements(els: MagnetElement[], now: number): void {
    this.els = els
    this.fetchedAt = now
    if (this.snapped) {
      const s = this.snapped
      const again = els.find((e) => e.id === s.id && sameBox(e.box, s.box)) ?? els.find((e) => sameBox(e.box, s.box, 4))
      this.snapped = again ?? null // the page changed under us: drop the snap
    }
  }

  markRefresh(now: number): void {
    this.lastRefreshAt = now
  }

  get snappedElement(): MagnetElement | null {
    return this.snapped
  }
  get fixating(): boolean {
    return this.fixStart !== null
  }

  /** True when a candidate refresh would help: a fixation has started and the list is missing, old or from before the fixation. */
  wantsRefresh(now: number): boolean {
    if (this.fixStart === null || now - this.fixStart < this.p.fixMs) return false
    if (now - this.lastRefreshAt < this.p.minRefreshGapMs) return false
    return !this.listUsable(now) || now - this.fetchedAt > this.p.ttlMs
  }

  private listUsable(now: number): boolean {
    if (this.fixStart === null) return false
    return now - this.fetchedAt <= this.p.ttlMs && this.fetchedAt >= this.fixStart - this.p.preFixMs
  }

  reset(): void {
    this.snapped = null
    this.fixStart = null
    this.cur = null
    this.prevRaw = null
    this.speed = 0
  }

  private candidates(display: MagnetCtx['display']): MagnetElement[] {
    const maxArea = display.width * display.height * this.p.maxAreaFrac
    return this.els.filter((e) => e.box.w > 0 && e.box.h > 0 && e.box.w * e.box.h <= maxArea)
  }

  private best(raw: Pt, display: MagnetCtx['display'], range: number): { e: MagnetElement; d: number } | null {
    let best: { e: MagnetElement; d: number; a: number } | null = null
    for (const e of this.candidates(display)) {
      const d = distToBox(raw, e.box)
      if (d > range) continue
      const a = e.box.w * e.box.h
      if (!best || d < best.d || (d === best.d && a < best.a)) best = { e, d, a } // ties (nested boxes): the innermost
    }
    return best
  }

  /** The point the real cursor should go to for this raw gaze point. Call once per gaze frame. */
  adjust(raw: Pt, now: number, ctx: MagnetCtx): Pt {
    const dt = this.lastT ? Math.min(200, Math.max(1, now - this.lastT)) : 33
    this.lastT = now
    if (this.prevRaw) {
      const inst = (Math.hypot(raw.x - this.prevRaw.x, raw.y - this.prevRaw.y) / dt) * 1000
      this.speed += (inst - this.speed) * Math.min(1, dt / 100)
    }
    this.prevRaw = raw
    if (!ctx.enabled || ctx.blocked) {
      this.snapped = null
      this.fixStart = null
      this.cur = raw
      this.hist.length = 0
      return raw
    }
    // fixation / saccade state
    if (this.speed > this.p.saccadeSpeed) this.snapped = null
    if (this.speed >= this.p.fixSpeed) this.fixStart = null
    else if (this.fixStart === null) this.fixStart = now
    const fixating = this.fixStart !== null && now - this.fixStart >= this.p.fixMs

    // choose the target element, with hysteresis
    if (this.snapped) {
      const dCur = distToBox(raw, this.snapped.box)
      if (dCur > this.p.releaseRange) this.snapped = null
      else {
        const o = this.best(raw, ctx.display, this.p.snapRange)
        if (o && o.e !== this.snapped && o.d + this.p.switchMargin < dCur) this.snapped = o.e
      }
    } else if (fixating && this.listUsable(now)) {
      this.snapped = this.best(raw, ctx.display, this.p.snapRange)?.e ?? null
    }

    const target = this.snapped ? snapPoint(raw, this.snapped.box, this.p) : raw
    this.hist.push({ ts: now, target, snapped: !!this.snapped })
    while (this.hist.length && now - this.hist[0]!.ts > 1500) this.hist.shift()

    // ease: free-running gaze passes through untouched; only snap / unsnap transitions are interpolated
    if (!this.cur) this.cur = raw
    const k = 1 - Math.exp((-dt * 2.3) / this.p.easeMs)
    if (!this.snapped && Math.hypot(this.cur.x - raw.x, this.cur.y - raw.y) < 1) {
      this.cur = raw
      return raw
    }
    const nx = this.cur.x + (target.x - this.cur.x) * k
    const ny = this.cur.y + (target.y - this.cur.y) * k
    this.cur = Math.hypot(nx - target.x, ny - target.y) < 0.75 ? target : { x: nx, y: ny }
    return this.cur
  }

  /** For a wink click: the snapped point the cursor was settled on in [ts-windowMs, ts], or null (use the raw gaze then). */
  pointAround(ts: number, windowMs = 300): Pt | null {
    const w = this.hist.filter((h) => h.ts <= ts && h.ts >= ts - windowMs)
    const last = w[w.length - 1]
    return last && last.snapped ? last.target : null
  }
}
