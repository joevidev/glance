import { describe, expect, it } from 'vitest'
import { distToBox, MagnetCore, snapPoint, type MagnetCtx, type MagnetElement, type Pt } from './magnet'

const display = { width: 1440, height: 900 }
const ctx: MagnetCtx = { enabled: true, blocked: false, display }
const btn: MagnetElement = { id: 1, box: { x: 500, y: 400, w: 100, h: 40 } } // center (550, 420)
const other: MagnetElement = { id: 2, box: { x: 620, y: 400, w: 100, h: 40 } }

/** Feed the same raw point at 30 fps for `ms`, refreshing the list like the wrapper does; returns the last output. */
function hold(c: MagnetCore, raw: Pt, t0: number, ms: number, els?: MagnetElement[], context: MagnetCtx = ctx): { out: Pt; t: number } {
  let out = raw
  let t = t0
  for (; t < t0 + ms; t += 33) {
    out = c.adjust(raw, t, context)
    if (els && c.wantsRefresh(t)) {
      c.setElements(els, t)
      c.markRefresh(t)
    }
  }
  return { out, t }
}
const near = (a: Pt, b: Pt, d = 1) => Math.hypot(a.x - b.x, a.y - b.y) <= d

describe('magnet: snapping', () => {
  it('distance is to the box, 0 inside', () => {
    expect(distToBox({ x: 550, y: 420 }, btn.box)).toBe(0)
    expect(distToBox({ x: 450, y: 420 }, btn.box)).toBe(50)
    expect(distToBox({ x: 470, y: 380 }, btn.box)).toBeCloseTo(Math.hypot(30, 20))
  })

  it('snaps to the center of a nearby element while fixating', () => {
    const c = new MagnetCore()
    const r = hold(c, { x: 470, y: 380 }, 1000, 1200, [btn])
    expect(c.snappedElement?.id).toBe(1)
    expect(near(r.out, { x: 550, y: 420 })).toBe(true)
  })

  it('does not snap while saccading (fast gaze)', () => {
    const c = new MagnetCore()
    let out = { x: 0, y: 0 }
    for (let i = 0; i < 60; i++) {
      out = c.adjust({ x: 100 + i * 40, y: 380 }, 1000 + i * 33, ctx) // ~1200 px/s, passing right over the button
      if (c.wantsRefresh(1000 + i * 33)) c.setElements([btn], 1000 + i * 33)
    }
    expect(c.snappedElement).toBeNull()
    expect(out.y).toBeGreaterThan(300) // raw passes through
  })

  it('does not snap before the fixation time', () => {
    const c = new MagnetCore()
    c.setElements([btn], 1000)
    c.adjust({ x: 470, y: 380 }, 1000, ctx)
    c.adjust({ x: 470, y: 380 }, 1033, ctx)
    expect(c.snappedElement).toBeNull()
  })

  it('does not snap when nothing is within range', () => {
    const c = new MagnetCore()
    const r = hold(c, { x: 400, y: 300 }, 1000, 1200, [btn]) // box is 100+ px away
    expect(c.snappedElement).toBeNull()
    expect(r.out).toEqual({ x: 400, y: 300 })
  })

  it('does not snap to huge boxes (> 40% of the screen)', () => {
    const c = new MagnetCore()
    const huge: MagnetElement = { id: 9, box: { x: 0, y: 0, w: 1440, h: 600 } }
    const r = hold(c, { x: 700, y: 300 }, 1000, 1200, [huge])
    expect(c.snappedElement).toBeNull()
    expect(r.out).toEqual({ x: 700, y: 300 })
  })

  it('does not trust a candidate list fetched before the fixation (page may have scrolled)', () => {
    const c = new MagnetCore()
    c.setElements([btn], 0)
    const r = hold(c, { x: 470, y: 380 }, 5000, 600) // no refresh provided
    expect(c.snappedElement).toBeNull()
    expect(r.out).toEqual({ x: 470, y: 380 })
    expect(c.wantsRefresh(r.t)).toBe(true)
  })
})

describe('magnet: hysteresis', () => {
  it('stays on the element until the gaze is more than 110 px from its box', () => {
    const c = new MagnetCore()
    let { t } = hold(c, { x: 470, y: 400 }, 1000, 1200, [btn])
    expect(c.snappedElement?.id).toBe(1)
    // 90 px left of the box: outside snapRange (70) but inside releaseRange: still snapped
    t = hold(c, { x: 410, y: 420 }, t, 400, [btn]).t
    expect(c.snappedElement?.id).toBe(1)
    // 130 px away: released, and the cursor follows the gaze again
    const r = hold(c, { x: 370, y: 420 }, t, 1000, [btn])
    expect(c.snappedElement).toBeNull()
    expect(near(r.out, { x: 370, y: 420 })).toBe(true)
  })

  it('switches to another element only when it is clearly closer (margin 25 px)', () => {
    const c = new MagnetCore()
    let { t } = hold(c, { x: 640, y: 420 }, 1000, 1200, [btn, other]) // inside "other" (d 0), 40 from btn
    expect(c.snappedElement?.id).toBe(2)
    // gaze moves to x=610: other d=10... still other. Move toward btn side: x=580 -> btn d 0, other d 40: 0+25<40 -> switch
    t = hold(c, { x: 580, y: 420 }, t, 400, [btn, other]).t
    expect(c.snappedElement?.id).toBe(1)
    // x=612: btn d=12, other d=8: not clearly closer, stay on btn
    hold(c, { x: 612, y: 420 }, t, 400, [btn, other])
    expect(c.snappedElement?.id).toBe(1)
  })

  it('drops the snap when the refreshed page no longer has the element', () => {
    const c = new MagnetCore()
    const r = hold(c, { x: 470, y: 380 }, 1000, 1200, [btn])
    expect(c.snappedElement?.id).toBe(1)
    c.setElements([{ id: 5, box: { x: 100, y: 100, w: 50, h: 20 } }], r.t)
    expect(c.snappedElement).toBeNull()
  })
})

describe('magnet: easing, geometry, switches', () => {
  it('never teleports: the first snapped frames move only part of the way, and it converges', () => {
    const c = new MagnetCore()
    const raw = { x: 470, y: 380 }
    c.setElements([btn], 0)
    let t = 1000
    c.setElements([btn], t - 50)
    const outs: Pt[] = []
    for (; t < 1900; t += 33) outs.push(c.adjust(raw, t, ctx))
    const first = outs.findIndex((o) => !near(o, raw, 0.5))
    expect(first).toBeGreaterThan(-1)
    const full = Math.hypot(550 - raw.x, 420 - raw.y)
    expect(Math.hypot(outs[first]!.x - raw.x, outs[first]!.y - raw.y)).toBeLessThan(full * 0.7)
    // monotone approach, no overshoot
    for (let i = first + 1; i < outs.length; i++) {
      expect(Math.hypot(outs[i]!.x - 550, outs[i]!.y - 420)).toBeLessThanOrEqual(Math.hypot(outs[i - 1]!.x - 550, outs[i - 1]!.y - 420) + 1e-6)
    }
    expect(near(outs[outs.length - 1]!, { x: 550, y: 420 }, 0.8)).toBe(true)
    // about 80-100 ms to cover ~90%
    const k = outs.slice(first).findIndex((o) => Math.hypot(o.x - 550, o.y - 420) < full * 0.1)
    expect(k * 33).toBeLessThanOrEqual(160)
  })

  it('large boxes: the cursor takes the gaze point clamped at least 6 px inside, per axis', () => {
    const p = snapPoint({ x: 100, y: 410 }, { x: 500, y: 400, w: 400, h: 40 })
    expect(p).toEqual({ x: 506, y: 420 }) // wide: x clamped to the inset edge, y centered
    expect(snapPoint({ x: 700, y: 410 }, { x: 500, y: 400, w: 400, h: 40 })).toEqual({ x: 700, y: 420 })
    expect(snapPoint({ x: 0, y: 0 }, { x: 500, y: 400, w: 4, h: 4 })).toEqual({ x: 502, y: 402 }) // tiny: center
  })

  it('a release glides back to the gaze, it does not jump', () => {
    const c = new MagnetCore()
    let { t } = hold(c, { x: 470, y: 380 }, 1000, 1200, [btn])
    const raw = { x: 100, y: 100 } // far away: unsnaps; speed spike also releases
    const o = c.adjust(raw, t + 33, ctx)
    expect(c.snappedElement).toBeNull()
    expect(Math.hypot(o.x - raw.x, o.y - raw.y)).toBeGreaterThan(5) // still gliding
    t += 33
    const r = hold(c, raw, t, 800, [btn])
    expect(near(r.out, raw)).toBe(true)
  })
})

describe('magnet: switches', () => {
  it('disabled by the toggle: raw passes through unchanged', () => {
    const c = new MagnetCore()
    const off = { ...ctx, enabled: false }
    const r = hold(c, { x: 470, y: 380 }, 1000, 1200, [btn], off)
    expect(c.snappedElement).toBeNull()
    expect(r.out).toEqual({ x: 470, y: 380 })
  })

  it('blocked (radial / drag / typing / confirm) releases and passes raw through', () => {
    const c = new MagnetCore()
    const { t } = hold(c, { x: 470, y: 380 }, 1000, 1200, [btn])
    expect(c.snappedElement?.id).toBe(1)
    const o = c.adjust({ x: 470, y: 380 }, t, { ...ctx, blocked: true })
    expect(c.snappedElement).toBeNull()
    expect(o).toEqual({ x: 470, y: 380 })
  })

  it('a wink click uses the snapped point only if the cursor was snapped just before it', () => {
    const c = new MagnetCore()
    const { t } = hold(c, { x: 470, y: 380 }, 1000, 1500, [btn])
    expect(c.pointAround(t - 100, 300)).toEqual({ x: 550, y: 420 })
    const c2 = new MagnetCore()
    const r2 = hold(c2, { x: 400, y: 300 }, 1000, 1500, [btn])
    expect(c2.pointAround(r2.t - 100, 300)).toBeNull()
  })

  it('asks for a refresh when a fixation starts, not while moving', () => {
    const c = new MagnetCore()
    for (let i = 0; i < 30; i++) {
      c.adjust({ x: i * 50, y: 300 }, 1000 + i * 33, ctx)
      expect(c.wantsRefresh(1000 + i * 33)).toBe(false)
    }
    const r = hold(c, { x: 1500, y: 300 }, 2100, 400)
    expect(c.wantsRefresh(r.t)).toBe(true)
  })
})
