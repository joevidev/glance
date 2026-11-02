// Full-screen 9-point calibration (one white dot at a time), then the gaze fit, then gesture training.
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { GazeCalibration, GestureCalibrator, calibrationPoints, type GazeFrame, type GestureName } from '@glance/gaze'
import { engine, type SavedCalibration } from '../lib/engine'

const FRAMES_PER_POINT = 25
const SETTLE_MS = 600
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type CalibResult = { saved: SavedCalibration; fit: { ok: boolean; looErrorPx: number; trainErrorPx: number; samples: number } }

/** Renders inside a window that is already full-screen. Calls onDone with the fitted gaze model, or null on cancel. */
export function CalibrationRun({ screen, onDone }: { screen: { width: number; height: number }; onDone: (r: { calib: GazeCalibration; fit: CalibResult['fit'] } | null) => void }) {
  const [idx, setIdx] = useState(-1)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<'intro' | 'settle' | 'collect'>('intro')
  const [warn, setWarn] = useState<string | null>(null)
  const points = useRef(calibrationPoints(9)).current
  const cancelled = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelled.current = true
        onDone(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  useEffect(() => {
    let alive = true
    engine.driving = false
    ;(async () => {
      const calib = new GazeCalibration()
      await sleep(1800) // intro
      for (let i = 0; i < points.length; i++) {
        if (!alive || cancelled.current) return
        const target = points[i]!
        setIdx(i)
        setProgress(0)
        setPhase('settle')
        await sleep(SETTLE_MS)
        setPhase('collect')
        ;(window as unknown as { __glanceTarget?: unknown }).__glanceTarget = target
        let n = 0
        let lastGood = performance.now()
        await new Promise<void>((resolve) => {
          const off = engine.subscribe((f: GazeFrame | null) => {
            if (!f) {
              if (performance.now() - lastGood > 1500) setWarn('I cannot see your face. Look at the camera light and sit back a little.')
              return
            }
            if (calib.addSample(f, target)) {
              lastGood = performance.now()
              setWarn(null)
              n++
              setProgress(n / FRAMES_PER_POINT)
              if (n >= FRAMES_PER_POINT) {
                off()
                resolve()
              }
            }
          })
          // give up on a point after 12 s of nothing and go on
          setTimeout(() => {
            off()
            resolve()
          }, 12000)
        })
      }
      ;(window as unknown as { __glanceTarget?: unknown }).__glanceTarget = null
      if (!alive || cancelled.current) return
      const fit = calib.fit(screen)
      onDone({ calib, fit })
    })()
    return () => {
      alive = false
    }
  }, [])

  const target = idx >= 0 ? points[idx] : null
  return (
    <div className="fixed inset-0 z-50 bg-black">
      {idx < 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="eyebrow">Calibration</div>
          <div className="headline text-5xl">Look at each dot.</div>
          <div className="text-xl text-white/60">Keep your head still. Follow the dot with your eyes only. Esc cancels.</div>
        </div>
      )}
      {target && (
        <motion.div
          key={idx}
          className="absolute"
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }}
        >
          <div className="absolute -translate-x-1/2 -translate-y-1/2">
            <svg width="96" height="96" className="-rotate-90" style={{ overflow: "visible" }}>
              <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="3" />
              <circle cx="48" cy="48" r="40" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeDasharray={251.3} strokeDashoffset={251.3 * (1 - progress)} style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,.8))', transition: 'stroke-dashoffset .08s linear' }} />
            </svg>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ width: phase === 'settle' ? 26 : 16, height: phase === 'settle' ? 26 : 16, transition: 'all .35s', boxShadow: '0 0 24px 4px rgba(255,255,255,.6)' }} />
          </div>
        </motion.div>
      )}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-center">
        {warn ? (
          <div className="glass glass-dark glass-pill px-6 py-2.5 text-white" style={{ borderRadius: 999 }}>
            <span className="relative">{warn}</span>
          </div>
        ) : (
          idx >= 0 && <div className="font-mono text-[12px] uppercase tracking-[0.16em] text-white/45">Point {idx + 1} of {points.length}</div>
        )}
      </div>
    </div>
  )
}

export interface GestureTrainResult {
  thresholds: SavedCalibration['thresholds']
  works: SavedCalibration['works']
  separation: Record<GestureName, number>
  swapEyes: boolean
}

export const GESTURE_STEPS: { key: 'neutral' | GestureName; title: string; hint: string }[] = [
  { key: 'neutral', title: 'Relax', hint: 'Face the screen, relaxed. Blink normally.' },
  { key: 'winkLeft', title: 'Wink left', hint: 'Close only your LEFT eye and hold it.' },
  { key: 'winkRight', title: 'Wink right', hint: 'Close only your RIGHT eye and hold it.' },
  { key: 'mouthOpen', title: 'Open your mouth', hint: 'Open wide, like a yawn, and hold it.' },
  { key: 'browsUp', title: 'Raise your brows', hint: 'Lift both eyebrows high and hold them.' },
]

/** Collects ~2 s of frames for one gesture step. Resolves with the mean blink signals (for the eye-swap check). */
export function collectGesture(cal: GestureCalibrator, key: 'neutral' | GestureName, ms: number, onTick: (p: number, f: GazeFrame | null) => void): Promise<{ meanL: number; meanR: number; frames: number }> {
  return new Promise((resolve) => {
    const t0 = performance.now()
    let sl = 0
    let sr = 0
    let n = 0
    const off = engine.subscribe((f) => {
      const p = Math.min(1, (performance.now() - t0) / ms)
      onTick(p, f)
      if (f && p > 0.2) {
        // skip the first 20%: the user is still getting into the pose
        if (key === 'neutral') cal.addNeutral(f)
        else cal.addGesture(key, f)
        sl += f.blinkLeft
        sr += f.blinkRight
        n++
      }
      if (p >= 1) {
        off()
        resolve({ meanL: n ? sl / n : 0, meanR: n ? sr / n : 0, frames: n })
      }
    })
  })
}
