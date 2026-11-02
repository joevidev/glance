// Pure logic of the personal eye profile: error statistics, verdict thresholds, validation targets,
// the validation measurement, the fine-tune (refit) and the mini-game score. No DOM, no Electron: tested in node.
import { GazeCalibration, GazeTracker, calibrationPoints, type GazeFrame, type ScreenSize, type Vec2 } from '@glance/gaze'
import type { ErrStats, GameRecord, GameTrial, ProfileData, ProfileSummary, Verdict } from '../../shared/profile-types'

// ------------------------------------------------------------------ verdict
/**
 * Verdict thresholds on the MEAN error (px, on a 1920x1080-ish screen) of targets the model has never seen.
 * Why these numbers: a webcam plus iris regression is about 100 to 200 px at best on real faces (the repo's own
 * estimate; the simulator gives about 20 px, which is not a real-world number). A link row on a web page is
 * 30 to 50 px tall, so under about 100 px the nearest element is usually the right one; 100 to 160 px is what a
 * good laptop webcam session gives and the intent model can resolve the remaining ambiguity; 160 to 250 px still
 * moves the cursor into the right region but needs the model to do most of the work; above 250 px (about 13% of a
 * 1920 px screen) the cursor is useless as a pointer and the user should redo the calibration. The mean (not the
 * median) decides because the user feels the misses. Both are shown.
 * These are deliberately a bit looser than the old leave-one-out labels (90/150/250), because a held-out point
 * measured live with smoothing is a harder, more honest test than leave-one-target-out on the calibration dots.
 */
export const VERDICT_THRESHOLDS = { excellent: 100, good: 160, usable: 250 } as const

export function verdictFor(meanPx: number): Verdict {
  if (!Number.isFinite(meanPx)) return 'Redo'
  if (meanPx < VERDICT_THRESHOLDS.excellent) return 'Excellent'
  if (meanPx < VERDICT_THRESHOLDS.good) return 'Good'
  if (meanPx < VERDICT_THRESHOLDS.usable) return 'Usable'
  return 'Redo'
}
/** The fine-tune is offered (and the validation screen leads with it) when the verdict is worse than Good. */
export const needsTune = (v: Verdict): boolean => v === 'Usable' || v === 'Redo'

export const VERDICT_NOTE: Record<Verdict, string> = {
  Excellent: 'Tight enough to pick between neighbouring links.',
  Good: 'Typical for a webcam. The model resolves the rest.',
  Usable: 'The cursor lands in the right area. A fine-tune with your own points will help.',
  Redo: 'Too far off to point with. Fine-tune, or recalibrate with your face lit from the front and your head still.',
}

// ------------------------------------------------------------------ statistics
export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
export function errStats(errorsPx: number[]): ErrStats {
  const e = errorsPx.filter(Number.isFinite)
  return { n: e.length, meanPx: mean(e), medianPx: median(e), maxPx: e.length ? Math.max(...e) : NaN, errorsPx: e }
}

// ------------------------------------------------------------------ targets
/** 6 validation targets, none of them on the 9-point calibration grid (8%, 50%, 92%) in either axis pair. */
export const VALIDATION_TARGETS: Vec2[] = [
  { x: 0.29, y: 0.27 },
  { x: 0.71, y: 0.27 },
  { x: 0.2, y: 0.62 },
  { x: 0.8, y: 0.66 },
  { x: 0.4, y: 0.8 },
  { x: 0.62, y: 0.46 },
]
/** 4 fresh targets for the before/after check after a fine-tune: not on the grid and not a validation target. */
export const FRESH_TARGETS: Vec2[] = [
  { x: 0.37, y: 0.4 },
  { x: 0.55, y: 0.14 },
  { x: 0.86, y: 0.42 },
  { x: 0.15, y: 0.85 },
]
export const SETTLE_MS = 400
export const LOOK_MS = 1000

export function onCalibrationGrid(p: Vec2): boolean {
  return calibrationPoints(9).some((g) => Math.abs(g.x - p.x) < 0.02 && Math.abs(g.y - p.y) < 0.02)
}

// ------------------------------------------------------------------ validation
export interface Segment {
  target: Vec2
  frames: GazeFrame[]
}
export interface TargetMeasure {
  target: Vec2
  /** mean distance (px) from the smoothed gaze to the target over the measured window; null = too few frames */
  errorPx: number | null
  used: number
}
export interface Evaluation {
  perTarget: TargetMeasure[]
  stats: ErrStats
}

/** The live tracker's settings (engine.applyCalibration): One Euro smoothing + dwell. */
export const trackerOpts = { dwell: { radiusPx: 70, dwellMs: 1000 } }

/**
 * Score a gaze model on recorded segments the way the live tracker would behave: every frame goes through a
 * GazeTracker (calibration -> clamp -> One Euro smoothing), frames in the first `settleMs` after the target
 * appeared are ignored (the eye is still travelling), frames held by a blink are ignored, and the error of a
 * target is the mean px distance between the smoothed point and the target over the rest.
 */
export function evaluateSegments(calib: GazeCalibration, screen: ScreenSize, segments: Segment[], o?: { settleMs?: number; minFrames?: number }): Evaluation {
  const settle = o?.settleMs ?? SETTLE_MS
  const minFrames = o?.minFrames ?? 5
  const tracker = new GazeTracker(calib, screen, trackerOpts)
  const perTarget: TargetMeasure[] = []
  for (const seg of segments) {
    const t0 = seg.frames[0]?.tsMs ?? 0
    const tx = seg.target.x * screen.width
    const ty = seg.target.y * screen.height
    const d: number[] = []
    for (const f of seg.frames) {
      const out = tracker.update(f)
      if (f.tsMs - t0 < settle || out.held || !out.pointPx) continue
      d.push(Math.hypot(out.pointPx.x - tx, out.pointPx.y - ty))
    }
    perTarget.push({ target: seg.target, errorPx: d.length >= minFrames ? mean(d) : null, used: d.length })
  }
  return { perTarget, stats: errStats(perTarget.flatMap((p) => (p.errorPx === null ? [] : [p.errorPx]))) }
}

// ------------------------------------------------------------------ fine-tune (refit)
export const cloneCalibration = (c: GazeCalibration): GazeCalibration => GazeCalibration.fromJSON(JSON.parse(JSON.stringify(c.toJSON())))

/** Add the settled frames of each segment as new calibration samples (GazeCalibration.addSample) and fit again on ALL samples. */
export function refit(calib: GazeCalibration, segments: Segment[], screen: ScreenSize, settleMs = SETTLE_MS): { added: number; fit: ReturnType<GazeCalibration['fit']> } {
  let added = 0
  for (const seg of segments) {
    const t0 = seg.frames[0]?.tsMs ?? 0
    for (const f of seg.frames) if (f.tsMs - t0 >= settleMs && calib.addSample(f, seg.target)) added++
  }
  return { added, fit: calib.fit(screen) }
}

export interface TuneResult {
  /** the tuned model (the input is left untouched) */
  tuned: GazeCalibration
  added: number
  looBeforePx: number
  looAfterPx: number
  fitOk: boolean
  /** old and new model scored on the SAME fresh segments */
  before: Evaluation
  after: Evaluation
  improved: boolean
}

/**
 * The personal model update: clone the model, add the validation segments as samples, fit again on everything,
 * then score old and new on fresh targets neither has seen. Reported as is, even when it did not improve.
 */
export function fineTune(calib: GazeCalibration, validationSegments: Segment[], freshSegments: Segment[], screen: ScreenSize): TuneResult {
  const looBeforePx = calib.fitResult?.looErrorPx ?? NaN
  const tuned = cloneCalibration(calib)
  const { added, fit } = refit(tuned, validationSegments, screen)
  const before = evaluateSegments(calib, screen, freshSegments)
  const after = fit.ok ? evaluateSegments(tuned, screen, freshSegments) : before
  return { tuned: fit.ok ? tuned : calib, added, looBeforePx, looAfterPx: fit.ok ? fit.looErrorPx : looBeforePx, fitOk: fit.ok, before, after, improved: fit.ok && after.stats.meanPx < before.stats.meanPx }
}

// ------------------------------------------------------------------ mini-game
export interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
}
/** Element nearest to a point: distance to the box edge (0 inside); ties (point inside several) go to the closest centre. */
export function nearestBox(p: Vec2, boxes: Box[]): Box | null {
  let best: Box | null = null
  let bd = Infinity
  let bc = Infinity
  for (const b of boxes) {
    const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w))
    const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h))
    const d = Math.hypot(dx, dy)
    const c = Math.hypot(p.x - (b.x + b.w / 2), p.y - (b.y + b.h / 2))
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && c < bc)) {
      best = b
      bd = d
      bc = c
    }
  }
  return best
}

export function scoreGame(trials: GameTrial[], at = new Date().toISOString()): GameRecord {
  const times = trials.flatMap((t) => (t.timeMs === null ? [] : [t.timeMs]))
  const hits = trials.filter((t) => t.hit).length
  return { at, trials, hits, total: trials.length, medianMs: times.length ? median(times) : null, misses: trials.length - hits }
}

// ------------------------------------------------------------------ profile summary
const GESTURE_LABELS: Record<string, string> = { winkLeft: 'Wink left', winkRight: 'Wink right', mouthOpen: 'Open mouth', browsUp: 'Brows up' }

export function buildSummary(p: Omit<ProfileData, 'summary'>): ProfileSummary {
  const loo = (p.calibration as { lastFit?: { looErrorPx?: number | null } } | null)?.lastFit?.looErrorPx
  const calLoo = (p.calibration as { looErrorPx?: number } | null)?.looErrorPx ?? loo ?? null
  const retuned = p.retune && p.retune.after.n ? p.retune.after.meanPx : null
  const validated = p.validation && p.validation.stats.n ? p.validation.stats.meanPx : null
  const gazeErrorPx = retuned ?? validated ?? (Number.isFinite(calLoo as number) ? (calLoo as number) : null)
  const works = p.gestures?.works
  return {
    gazeErrorPx,
    errorSource: retuned !== null ? 'retune' : validated !== null ? 'validation' : gazeErrorPx !== null ? 'loo' : null,
    medianPx: retuned !== null ? p.retune!.after.medianPx : validated !== null ? p.validation!.stats.medianPx : null,
    verdict: gazeErrorPx !== null ? verdictFor(gazeErrorPx) : null,
    looErrorPx: Number.isFinite(calLoo as number) ? (calLoo as number) : null,
    simulated: p.simulated,
    gesturesWorking: works ? Object.entries(works).filter(([, v]) => v).map(([k]) => GESTURE_LABELS[k] ?? k) : [],
    gesturesTotal: 4,
    game: p.game ? { hits: p.game.hits, total: p.game.total, medianMs: p.game.medianMs } : null,
    retune: p.retune ? { beforePx: p.retune.before.meanPx, afterPx: p.retune.after.meanPx } : null,
    lastTunedAt: p.retune?.at ?? p.validation?.at ?? p.gestures?.at ?? null,
  }
}

export const emptyProfile = (simulated: boolean, screen: { width: number; height: number } | null): ProfileData => {
  const now = new Date().toISOString()
  return { version: 1, createdAt: now, updatedAt: now, simulated, screen, calibration: null, validation: null, retune: null, game: null, gestures: null, history: [], summary: null }
}

export const fmtPx = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)} px`)
