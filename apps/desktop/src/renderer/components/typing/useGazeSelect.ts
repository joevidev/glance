// Dwell selection for the Typing panel. Gaze arrives from the main process in window coordinates ('typing:gaze'); the element under it
// that carries data-gaze="<id>" is "hot". Holding the gaze on it for dwellFor(id) ms fires onSelect(id); a left wink fires it at once.
import { useEffect, useRef, useState } from 'react'

export interface Hot {
  id: string
  p: number
}

const GRACE_MS = 220 // gaze jitter: leaving a key for less than this keeps the progress
const COOLDOWN_MS = 450 // after a selection, the same key needs a fresh look

export function useGazeSelect(onSelect: (id: string) => void, dwellFor: (id: string) => number): { hot: Hot | null; gaze: { x: number; y: number } | null } {
  const [hot, setHot] = useState<Hot | null>(null)
  const [gaze, setGaze] = useState<{ x: number; y: number } | null>(null)
  const sel = useRef(onSelect)
  const dwell = useRef(dwellFor)
  sel.current = onSelect
  dwell.current = dwellFor
  const cur = useRef<{ id: string; since: number; lastSeen: number } | null>(null)
  const lastP = useRef(-1)

  useEffect(() => {
    const idAt = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-gaze]')
      return el?.dataset.gaze ?? null
    }
    const fire = (id: string) => {
      cur.current = { id, since: performance.now() + COOLDOWN_MS, lastSeen: performance.now() }
      sel.current(id)
    }
    const offGaze = window.glance.on('typing:gaze', (g) => {
      setGaze(g)
      const now = performance.now()
      const id = g ? idAt(g.x, g.y) : null
      const c = cur.current
      if (id) {
        if (c && c.id === id) c.lastSeen = now
        else cur.current = { id, since: now, lastSeen: now }
      } else if (c && now - c.lastSeen > GRACE_MS) {
        cur.current = null
      }
    })
    const offWink = window.glance.on('typing:wink', () => {
      const c = cur.current
      if (c && performance.now() - c.lastSeen < 600) fire(c.id)
    })
    const tick = () => {
      const now = performance.now()
      const c = cur.current
      if (c && now - c.lastSeen > GRACE_MS) cur.current = null
      const k = cur.current
      if (k) {
        const p = Math.max(0, Math.min(1, (now - k.since) / dwell.current(k.id)))
        if (p >= 1) fire(k.id)
        else if (Math.abs(p - lastP.current) > 0.015 || lastP.current < 0) {
          lastP.current = p
          setHot({ id: k.id, p })
        }
      } else if (lastP.current !== -1) {
        lastP.current = -1
        setHot(null)
      }
    }
    // setInterval, not rAF: a non-activating panel is not always repainted, and the dwell must keep time regardless
    const timer = setInterval(tick, 33)
    return () => {
      offGaze()
      offWink()
      clearInterval(timer)
    }
  }, [])

  return { hot, gaze }
}
