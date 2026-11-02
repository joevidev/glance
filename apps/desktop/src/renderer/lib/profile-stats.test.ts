import { describe, expect, it } from 'vitest'
import { GazeCalibration, calibrationPoints, simulateGaze, type GazeFrame, type Vec2 } from '@glance/gaze'
import {
  FRESH_TARGETS,
  VALIDATION_TARGETS,
  buildSummary,
  cloneCalibration,
  emptyProfile,
  errStats,
  evaluateSegments,
  fineTune,
  median,
  mean,
  needsTune,
  nearestBox,
  onCalibrationGrid,
  refit,
  scoreGame,
  verdictFor,
  type Segment,
} from './profile-stats'

const SCREEN = { width: 1920, height: 1080 }

/** Calibrate on the simulator the way the app does (9 points, ~25 settled frames each). */
function calibrate(seed: number, noise = 1, pts: Vec2[] = calibrationPoints(9)): GazeCalibration {
  const c = new GazeCalibration()
  pts.forEach((p, i) => {
    const { frames } = simulateGaze([p], { msPerPoint: 1000, saccadeMs: 1, seed: seed * 100 + i, noise })
    frames.slice(5, 30).forEach((f) => c.addSample(f, p))
  })
  c.fit(SCREEN)
  return c
}
/** One look at a target: 1400 ms of frames at 30 fps (400 ms settle + 1000 ms window), like the validation round. */
function look(t: Vec2, seed: number, noise = 1, startMs = 0): Segment {
  return { target: t, frames: simulateGaze([t], { msPerPoint: 1400, saccadeMs: 1, seed, noise, startMs }).frames }
}

/** Consecutive looks with monotonic timestamps (as in the app: one shared clock). */
const looks = (targets: Vec2[], seedBase: number, noise = 1): Segment[] => targets.map((t, i) => look(t, seedBase + i, noise, i * 2000))

describe('error statistics', () => {
  it('mean and median', () => {
    expect(mean([1, 2, 3, 10])).toBe(4)
    expect(median([1, 2, 3, 10])).toBe(2.5)
    expect(median([5, 1, 3])).toBe(3)
    expect(Number.isNaN(median([]))).toBe(true)
  })
  it('errStats drops non-finite values and reports max', () => {
    const s = errStats([100, 200, NaN, 600, Infinity])
    expect(s.n).toBe(3)
    expect(s.meanPx).toBeCloseTo(300)
    expect(s.medianPx).toBe(200)
    expect(s.maxPx).toBe(600)
    expect(errStats([]).n).toBe(0)
  })
})

describe('verdict thresholds', () => {
  it('Excellent < 100 <= Good < 160 <= Usable < 250 <= Redo', () => {
    expect(verdictFor(0)).toBe('Excellent')
    expect(verdictFor(99.9)).toBe('Excellent')
    expect(verdictFor(100)).toBe('Good')
    expect(verdictFor(159.9)).toBe('Good')
    expect(verdictFor(160)).toBe('Usable')
    expect(verdictFor(249.9)).toBe('Usable')
    expect(verdictFor(250)).toBe('Redo')
    expect(verdictFor(NaN)).toBe('Redo')
    expect(verdictFor(Infinity)).toBe('Redo')
  })
  it('the fine-tune is needed only when worse than Good', () => {
    expect(needsTune('Excellent')).toBe(false)
    expect(needsTune('Good')).toBe(false)
    expect(needsTune('Usable')).toBe(true)
    expect(needsTune('Redo')).toBe(true)
  })
})

describe('targets', () => {
  it('validation and fresh targets are off the 9-point grid and distinct from each other', () => {
    expect(VALIDATION_TARGETS).toHaveLength(6)
    expect(FRESH_TARGETS).toHaveLength(4)
    for (const t of [...VALIDATION_TARGETS, ...FRESH_TARGETS]) {
      expect(onCalibrationGrid(t)).toBe(false)
      expect(t.x).toBeGreaterThan(0.08)
      expect(t.x).toBeLessThan(0.92)
      expect(t.y).toBeGreaterThan(0.08)
      expect(t.y).toBeLessThan(0.92)
    }
    const all = [...VALIDATION_TARGETS, ...FRESH_TARGETS].map((t) => `${t.x},${t.y}`)
    expect(new Set(all).size).toBe(10)
  })
  it('onCalibrationGrid recognises grid points', () => {
    expect(onCalibrationGrid({ x: 0.5, y: 0.5 })).toBe(true)
    expect(onCalibrationGrid({ x: 0.08, y: 0.92 })).toBe(true)
  })
})

describe('validation measurement (simulated gaze)', () => {
  const calib = calibrate(1)
  it('measures a small, finite error on unseen points', () => {
    const ev = evaluateSegments(calib, SCREEN, looks(VALIDATION_TARGETS, 900))
    expect(ev.stats.n).toBe(6)
    expect(ev.stats.meanPx).toBeGreaterThan(0)
    // the simulator is easy: tens of px. A real webcam is 100-250 px; this bound only guards the pipeline.
    expect(ev.stats.meanPx).toBeLessThan(120)
    expect(verdictFor(ev.stats.meanPx)).toBe('Excellent')
  })
  it('ignores the settling frames: a saccade at the start does not count', () => {
    const far: Vec2 = { x: 0.9, y: 0.9 }
    const t = VALIDATION_TARGETS[0]!
    const lead = simulateGaze([far], { msPerPoint: 300, saccadeMs: 1, seed: 5 }).frames // 300 ms looking elsewhere
    const body = simulateGaze([t], { msPerPoint: 1100, saccadeMs: 1, seed: 6, startMs: 300 }).frames
    const seg: Segment = { target: t, frames: [...lead, ...body] }
    const withSettle = evaluateSegments(calib, SCREEN, [seg], { settleMs: 400 }).stats.meanPx
    const noSettle = evaluateSegments(calib, SCREEN, [seg], { settleMs: 0 }).stats.meanPx
    expect(noSettle).toBeGreaterThan(withSettle * 1.5)
  })
  it('a target with too few usable frames is left out, not counted as zero', () => {
    const t = VALIDATION_TARGETS[1]!
    const seg = look(t, 3)
    const short: Segment = { target: t, frames: seg.frames.slice(0, 14) } // 14 frames = 466 ms: only ~2 after the settle
    const ev = evaluateSegments(calib, SCREEN, [short, look(VALIDATION_TARGETS[2]!, 4, 1, 2000)])
    expect(ev.perTarget[0]!.errorPx).toBeNull()
    expect(ev.stats.n).toBe(1)
  })
  it('frames held by a blink are not measured', () => {
    const t = VALIDATION_TARGETS[3]!
    const seg = look(t, 8)
    const blinked: Segment = { target: t, frames: seg.frames.map((f, i): GazeFrame => (i > 14 ? { ...f, blinkLeft: 0.9, blinkRight: 0.9 } : f)) }
    const ev = evaluateSegments(calib, SCREEN, [blinked])
    expect(ev.perTarget[0]!.errorPx).toBeNull() // everything after the settle is held
  })
  it('is deterministic', () => {
    const segs = looks(VALIDATION_TARGETS, 900)
    expect(evaluateSegments(calib, SCREEN, segs).stats.meanPx).toBe(evaluateSegments(calib, SCREEN, segs).stats.meanPx)
  })
})

describe('refit (the fine-tune)', () => {
  it('adds only settled frames as samples and fits on all samples', () => {
    const c = calibrate(2)
    const before = c.sampleCount
    const segs = looks(VALIDATION_TARGETS, 50)
    const { added, fit } = refit(c, segs, SCREEN)
    expect(added).toBeGreaterThan(0)
    // 1400 ms at 30 fps = ~42 frames per target, the first 400 ms (~12) are skipped
    expect(added).toBeLessThanOrEqual(6 * 31)
    expect(added).toBeGreaterThanOrEqual(6 * 25)
    expect(c.sampleCount).toBe(before + added)
    expect(fit.ok).toBe(true)
    expect(fit.samples).toBe(before + added)
  })
  it('fineTune leaves the original model untouched and scores old and new on the same fresh targets', () => {
    const c = calibrate(3)
    const n0 = c.sampleCount
    const val = looks(VALIDATION_TARGETS, 70)
    const fresh = looks(FRESH_TARGETS, 90)
    const r = fineTune(c, val, fresh, SCREEN)
    expect(c.sampleCount).toBe(n0)
    expect(r.tuned).not.toBe(c)
    expect(r.tuned.sampleCount).toBe(n0 + r.added)
    expect(r.fitOk).toBe(true)
    expect(r.before.stats.n).toBe(4)
    expect(r.after.stats.n).toBe(4)
    expect(r.improved).toBe(r.after.stats.meanPx < r.before.stats.meanPx)
    expect(Number.isFinite(r.looBeforePx)).toBe(true)
    expect(Number.isFinite(r.looAfterPx)).toBe(true)
  })
  it('a model fitted on 5 noisy points improves with the 6 extra targets (mean over 6 seeds)', () => {
    let b = 0
    let a = 0
    for (let s = 1; s <= 6; s++) {
      const weak = calibrate(s, 3, calibrationPoints(5))
      const r = fineTune(
        weak,
        looks(VALIDATION_TARGETS, s * 1000, 3),
        looks(FRESH_TARGETS, s * 2000, 3),
        SCREEN,
      )
      b += r.before.stats.meanPx
      a += r.after.stats.meanPx
    }
    expect(a / 6).toBeLessThan(b / 6)
  })
  it('reports honestly when it did not improve (flag follows the numbers)', () => {
    const c = calibrate(4, 0.2) // already excellent
    const r = fineTune(c, looks(VALIDATION_TARGETS, 10, 0.2), looks(FRESH_TARGETS, 30, 0.2), SCREEN)
    expect(r.improved).toBe(r.after.stats.meanPx < r.before.stats.meanPx)
  })
  it('cloneCalibration is independent', () => {
    const c = calibrate(5)
    const k = cloneCalibration(c)
    expect(k.sampleCount).toBe(c.sampleCount)
    k.clear()
    expect(c.isFitted).toBe(true)
  })
})

describe('mini-game', () => {
  const boxes = [
    { id: 'Archive', x: 100, y: 100, w: 200, h: 60 },
    { id: 'Reply', x: 400, y: 100, w: 90, h: 40 },
    { id: 'Star', x: 100, y: 300, w: 60, h: 60 },
  ]
  it('nearest element: inside wins, else edge distance', () => {
    expect(nearestBox({ x: 150, y: 120 }, boxes)!.id).toBe('Archive')
    expect(nearestBox({ x: 380, y: 120 }, boxes)!.id).toBe('Reply') // 20 px from Reply, 80 from Archive
    expect(nearestBox({ x: 130, y: 250 }, boxes)!.id).toBe('Star')
    expect(nearestBox({ x: 0, y: 0 }, [])).toBeNull()
  })
  it('score: hits, misses and median time to wink', () => {
    const t = (hit: boolean, timeMs: number | null) => ({ target: 'x', picked: hit ? 'x' : 'y', hit, timeMs, gazeErrPx: 50, timedOut: timeMs === null })
    const g = scoreGame([t(true, 1000), t(true, 3000), t(false, 2000), t(false, null)])
    expect(g.total).toBe(4)
    expect(g.hits).toBe(2)
    expect(g.misses).toBe(2)
    expect(g.medianMs).toBe(2000)
    expect(scoreGame([]).medianMs).toBeNull()
  })
})

describe('profile summary', () => {
  it('prefers the tuned error, then validation, then leave-one-out; carries the simulated flag', () => {
    const p = emptyProfile(true, SCREEN)
    p.calibration = { looErrorPx: 22 }
    expect(buildSummary(p)).toMatchObject({ gazeErrorPx: 22, errorSource: 'loo', simulated: true })
    p.validation = { at: 'v', stats: errStats([180, 220]), verdict: 'Usable' }
    expect(buildSummary(p)).toMatchObject({ gazeErrorPx: 200, errorSource: 'validation', verdict: 'Usable', lastTunedAt: 'v' })
    p.retune = { at: 'r', samplesAdded: 150, before: errStats([200]), after: errStats([120, 140]), looBeforePx: 22, looAfterPx: 20, improved: true, verdictAfter: 'Good' }
    p.game = scoreGame([{ target: 'a', picked: 'a', hit: true, timeMs: 900, gazeErrPx: 10, timedOut: false }])
    p.gestures = { at: 'g', works: { winkLeft: true, winkRight: false, mouthOpen: true, browsUp: true }, separation: {}, swapEyes: false }
    const s = buildSummary(p)
    expect(s).toMatchObject({ gazeErrorPx: 130, errorSource: 'retune', verdict: 'Good', lastTunedAt: 'r', retune: { beforePx: 200, afterPx: 130 }, game: { hits: 1, total: 1, medianMs: 900 } })
    expect(s.gesturesWorking).toEqual(['Wink left', 'Open mouth', 'Brows up'])
  })
})
