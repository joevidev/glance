// Which gaze point a voice command uses. People look away while finishing a sentence, so the point is the MEDIAN
// of the gaze samples over the last 400 ms before the user pressed stop; the point at speech start is the fallback.

export type Pt = { x: number; y: number }
export type GazeSample = { ts: number; p: Pt }
export type GazePick = { point: Pt; source: 'stop-median' | 'start' | 'latest'; samples: number }

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export interface PickOptions {
  /** Window before the stop press. */
  windowMs?: number
  /** Samples this far after the press still count (IPC latency between the key and the main process). */
  graceMs?: number
  /** Fewer samples than this in the window means the tracker lost the face: prefer the start fallback. */
  minSamples?: number
  /** The gaze at the moment recording started. */
  startGaze?: Pt | null
  /** The latest gaze right now (last resort). */
  latest?: Pt | null
}

export function pickGaze(hist: readonly GazeSample[], stopTs: number, o: PickOptions = {}): GazePick | null {
  const windowMs = o.windowMs ?? 400
  const grace = o.graceMs ?? 60
  const minSamples = o.minSamples ?? 3
  const win = hist.filter((h) => h.ts >= stopTs - windowMs && h.ts <= stopTs + grace)
  const med = () => ({ x: median(win.map((h) => h.p.x)), y: median(win.map((h) => h.p.y)) })
  if (win.length >= minSamples) return { point: med(), source: 'stop-median', samples: win.length }
  if (o.startGaze) return { point: o.startGaze, source: 'start', samples: win.length }
  if (win.length > 0) return { point: med(), source: 'stop-median', samples: win.length }
  if (o.latest) return { point: o.latest, source: 'latest', samples: 0 }
  return null
}
