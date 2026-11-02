// Full-screen target round used by the validation ("do your eyes hit points they were not trained on?") and by the
// fine-tune ("now 4 fresh points"). One white dot at a time, same look as the calibration. Records the raw frames per
// target; the measuring and refitting live in lib/profile-stats.ts (pure, tested).
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { GazeFrame, Vec2 } from '@glance/gaze'
import { engine } from '../../lib/engine'
import { FRESH_TARGETS, LOOK_MS, SETTLE_MS, VALIDATION_TARGETS, type Segment } from '../../lib/profile-stats'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MIN_AFTER_SETTLE = 8

export type TunePlan = 'validate' | 'retune' | 'refit'
export interface TuneOutput {
  /** frames at the 6 validation targets (also the extra samples for the refit) */
  validation: Segment[] | null
  /** frames at the 4 fresh targets (the before/after check) */
  fresh: Segment[] | null
}

const win = window as unknown as { __glanceTarget?: Vec2 | null }

/** Look at one dot: returns its frames, or null when the face was not seen. */
async function lookAt(target: Vec2, onProgress: (p: number) => void, onWarn: (w: string | null) => void, cancelled: () => boolean): Promise<Segment | null> {
  const frames: GazeFrame[] = []
  const t0 = performance.now()
  win.__glanceTarget = target
  let lastGood = t0
  await new Promise<void>((resolve) => {
    const off = engine.subscribe((f) => {
      const now = performance.now()
      if (cancelled()) {
        off()
        return resolve()
      }
      if (!f) {
        if (now - lastGood > 1500) onWarn('I cannot see your face. Look at the camera light and sit back a little.')
        return
      }
      lastGood = now
      onWarn(null)
      frames.push(f)
      onProgress(Math.min(1, (now - t0) / (SETTLE_MS + LOOK_MS)))
      const settled = frames.filter((x) => x.tsMs - t0 >= SETTLE_MS).length
      if (now - t0 >= SETTLE_MS + LOOK_MS && settled >= MIN_AFTER_SETTLE) {
        off()
        resolve()
      }
    })
    // give up on a point after 7 s and go on
    setTimeout(() => {
      off()
      resolve()
    }, 7000)
  })
  win.__glanceTarget = null
  const t1 = frames[0]?.tsMs ?? t0
  return frames.filter((x) => x.tsMs - t1 >= SETTLE_MS).length >= MIN_AFTER_SETTLE ? { target, frames } : null
}

export function TuneRun({ plan, onDone }: { plan: TunePlan; onDone: (o: TuneOutput | null) => void }) {
  const [label, setLabel] = useState<string>('')
  const [target, setTarget] = useState<Vec2 | null>(null)
  const [idx, setIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const [settling, setSettling] = useState(true)
  const [warn, setWarn] = useState<string | null>(null)
  const [intro, setIntro] = useState<{ eyebrow: string; title: string; sub: string } | null>({
    eyebrow: plan === 'refit' ? 'Fine-tune' : 'Validation',
    title: plan === 'refit' ? 'Four fresh points.' : 'Six new points.',
    sub: plan === 'refit' ? 'Your model learned from the last round. Look at each dot to see if it helped.' : 'None of these were in the calibration. Look at each dot, head still. Esc cancels.',
  })
  const cancelled = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelled.current = true
        win.__glanceTarget = null
        onDone(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  useEffect(() => {
    let alive = true
    engine.driving = false
    const round = async (targets: Vec2[], name: string): Promise<Segment[]> => {
      const out: Segment[] = []
      for (let i = 0; i < targets.length; i++) {
        if (!alive || cancelled.current) return out
        setLabel(`${name} · point ${i + 1} of ${targets.length}`)
        setIdx((n) => n + 1)
        setTarget(targets[i]!)
        setProgress(0)
        setSettling(true)
        setTimeout(() => setSettling(false), SETTLE_MS)
        const seg = await lookAt(targets[i]!, setProgress, setWarn, () => !alive || cancelled.current)
        if (seg) out.push(seg)
        setTarget(null)
        await sleep(120)
      }
      return out
    }
    ;(async () => {
      await sleep(1700)
      setIntro(null)
      let validation: Segment[] | null = null
      let fresh: Segment[] | null = null
      if (plan === 'validate' || plan === 'retune') validation = await round(VALIDATION_TARGETS, 'Validation')
      if (!alive || cancelled.current) return
      if (plan === 'retune') {
        setIntro({ eyebrow: 'Fine-tune', title: 'Updating your model…', sub: 'Adding those six points to the calibration. Four fresh points next.' })
        await sleep(1500)
        setIntro(null)
      }
      if (plan === 'retune' || plan === 'refit') fresh = await round(FRESH_TARGETS, 'Fresh')
      if (!alive || cancelled.current) return
      onDone({ validation, fresh })
    })()
    return () => {
      alive = false
      win.__glanceTarget = null
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {intro && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="eyebrow">{intro.eyebrow}</div>
          <div className="headline text-5xl">{intro.title}</div>
          <div className="max-w-[640px] text-xl text-white/60">{intro.sub}</div>
        </div>
      )}
      {target && (
        <motion.div key={idx} className="absolute" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }} style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }}>
          <div className="absolute -translate-x-1/2 -translate-y-1/2">
            <svg width="96" height="96" className="-rotate-90" style={{ overflow: 'visible' }}>
              <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="3" />
              <circle cx="48" cy="48" r="40" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeDasharray={251.3} strokeDashoffset={251.3 * (1 - progress)} style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,.8))', transition: 'stroke-dashoffset .08s linear' }} />
            </svg>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ width: settling ? 26 : 16, height: settling ? 26 : 16, transition: 'all .35s', boxShadow: '0 0 24px 4px rgba(255,255,255,.6)' }} />
          </div>
        </motion.div>
      )}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-center">
        {warn ? (
          <div className="glass glass-dark glass-pill px-6 py-2.5 text-white" style={{ borderRadius: 999 }}>
            <span className="relative">{warn}</span>
          </div>
        ) : (
          label && <div className="font-mono text-[12px] uppercase tracking-[0.16em] text-white/45">{label}</div>
        )}
      </div>
    </div>
  )
}
