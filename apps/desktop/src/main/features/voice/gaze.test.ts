import { describe, expect, it } from 'vitest'
import { median, pickGaze, type GazeSample } from './gaze'

// 30 fps gaze history: the user looks at the invoice (800, 400) for 2 s, then looks away to (100, 900) over the last 150 ms
const T0 = 10_000
function history(): GazeSample[] {
  const h: GazeSample[] = []
  for (let t = 0; t <= 2000; t += 33) {
    const away = t > 1850
    h.push({ ts: T0 + t, p: away ? { x: 100, y: 900 } : { x: 800 + ((t / 33) % 3) * 4, y: 400 + ((t / 33) % 2) * 3 } })
  }
  return h
}

describe('median', () => {
  it('odd, even, outliers', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([5, 5, 5, 900])).toBe(5)
  })
})

describe('pickGaze', () => {
  it('uses the median of the last 400 ms before stop, ignoring a late glance away', () => {
    const stop = T0 + 2000
    const g = pickGaze(history(), stop, { startGaze: { x: 1, y: 1 } })!
    expect(g.source).toBe('stop-median')
    expect(g.point.x).toBeGreaterThan(790)
    expect(g.point.x).toBeLessThan(815)
    expect(g.point.y).toBeGreaterThan(395)
    expect(g.point.y).toBeLessThan(410)
    expect(g.samples).toBeGreaterThanOrEqual(10)
  })
  it('the old 700 ms mean would have been pulled away; the median is not', () => {
    const h = history().filter((s) => s.ts >= T0 + 1300)
    const mean = h.reduce((a, s) => a + s.p.x, 0) / h.length
    const g = pickGaze(history(), T0 + 2000)!
    expect(Math.abs(g.point.x - 800)).toBeLessThan(Math.abs(mean - 800))
  })
  it('ignores samples older than the window and samples long after the press', () => {
    const h: GazeSample[] = [
      { ts: 1000, p: { x: 0, y: 0 } },
      { ts: 5000, p: { x: 50, y: 50 } },
      { ts: 5100, p: { x: 50, y: 50 } },
      { ts: 5200, p: { x: 50, y: 50 } },
      { ts: 9000, p: { x: 999, y: 999 } },
    ]
    expect(pickGaze(h, 5300)!.point).toEqual({ x: 50, y: 50 })
  })
  it('falls back to the speech-start point when the tracker lost the face near stop', () => {
    const h: GazeSample[] = [{ ts: 1000, p: { x: 10, y: 10 } }]
    const g = pickGaze(h, 5000, { startGaze: { x: 640, y: 360 }, latest: { x: 1, y: 1 } })!
    expect(g).toMatchObject({ source: 'start', point: { x: 640, y: 360 } })
  })
  it('with too few samples and no start point it still uses what it has, then the latest, then null', () => {
    expect(pickGaze([{ ts: 4900, p: { x: 7, y: 8 } }], 5000)!.point).toEqual({ x: 7, y: 8 })
    expect(pickGaze([], 5000, { latest: { x: 2, y: 3 } })).toMatchObject({ source: 'latest', point: { x: 2, y: 3 } })
    expect(pickGaze([], 5000)).toBeNull()
  })
})
