// Mini-game "Look and wink": 8 glass buttons of different sizes, one prompt at a time ("Look at Archive and wink").
// Per trial it records whether the gaze-nearest element was the target, the time to wink, and the miss.
// The gaze comes from the saved calibration through the same smoothing as the live cursor, the wink from the same
// detector, both run here (the real cursor is parked while the game runs). Gaze never clicks by itself: only a wink counts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { simulateGaze, GazeCalibration, GazeTracker, GestureDetector, type GazeFrame, type Vec2 } from '@glance/gaze'
import { Button } from '@glance/ui/components/button'
import { Badge } from '@glance/ui/components/badge'
import { Card } from '@glance/ui/components/card'
import { cn } from '@glance/ui/lib/utils'
import type { GameRecord, GameTrial } from '../../../shared/profile-types'
import { engine, type SavedCalibration } from '../../lib/engine'
import { nearestBox, scoreGame, trackerOpts, type Box } from '../../lib/profile-stats'
import { recordGame } from '../../lib/profile'
import { SimBadge } from './ValidateFlow'

interface Btn {
  id: string
  /** top-left in % of the play area, size in px */
  x: number
  y: number
  w: number
  h: number
}
// 8 buttons, deliberately different sizes: the small ones are hard for a webcam, that is the point.
const BUTTONS: Btn[] = [
  { id: 'Archive', x: 6, y: 8, w: 190, h: 64 },
  { id: 'Reply', x: 44, y: 5, w: 120, h: 44 },
  { id: 'Forward', x: 66, y: 12, w: 236, h: 76 },
  { id: 'Delete', x: 25, y: 38, w: 96, h: 40 },
  { id: 'Star', x: 52, y: 40, w: 64, h: 64 },
  { id: 'Snooze', x: 74, y: 48, w: 150, h: 52 },
  { id: 'Send', x: 8, y: 70, w: 268, h: 84 },
  { id: 'Mute', x: 58, y: 74, w: 86, h: 40 },
]
// fixed prompt order so a run is comparable with the next one
const ORDER = ['Archive', 'Send', 'Star', 'Forward', 'Delete', 'Mute', 'Reply', 'Snooze']
const TIMEOUT_MS = 8000
const FEEDBACK_MS = 800

type Phase = 'intro' | 'play' | 'done'

export function LookAndWink({ saved, display, simulated, onDone, onSkip }: { saved: SavedCalibration; display: { x: number; y: number; w: number; h: number } | null; simulated: boolean; onDone: () => void; onSkip: () => void }) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [trial, setTrial] = useState(-1)
  const [flash, setFlash] = useState<{ id: string; hit: boolean; text: string } | null>(null)
  const [result, setResult] = useState<GameRecord | null>(null)
  const [promptLeft, setPromptLeft] = useState(1)
  const area = useRef<HTMLDivElement>(null)
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  const alive = useRef(true)
  const canWink = saved.works.winkLeft || saved.works.winkRight
  const calib = useMemo(() => GazeCalibration.fromJSON(saved.calib), [saved])
  const screen = saved.screen

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /** Gaze (display px) -> client px of this window. */
  const toClient = (g: Vec2): Vec2 => ({
    x: g.x - (window.screenX - (display?.x ?? 0)),
    y: g.y - (window.screenY - (display?.y ?? 0) + (window.outerHeight - window.innerHeight)),
  })
  const boxes = (): Box[] =>
    BUTTONS.flatMap((b) => {
      const r = refs.current[b.id]?.getBoundingClientRect()
      return r ? [{ id: b.id, x: r.left, y: r.top, w: r.width, h: r.height }] : []
    })

  const play = async () => {
    setPhase('play')
    engine.driving = false // the real cursor and clicks stay parked during the game
    const tracker = new GazeTracker(calib, screen, trackerOpts)
    const det = new GestureDetector(saved.thresholds)
    const trials: GameTrial[] = []
    let cur: { id: string; t0: number; resolve: (t: GameTrial) => void } | null = null

    const onFrame = (raw: GazeFrame | null) => {
      if (!raw) return
      tracker.update(raw)
      const f = saved.swapEyes ? { ...raw, blinkLeft: raw.blinkRight, blinkRight: raw.blinkLeft } : raw
      for (const ev of det.update(f)) {
        if (!cur) continue
        const ok = (ev.type === 'wink_left' && saved.works.winkLeft) || (ev.type === 'wink_right' && saved.works.winkRight)
        if (!ok) continue
        const g = tracker.recentPoint(350) // eyelid motion starts before the blink score crosses: use the gaze from a moment ago
        const gp = g ? toClient({ x: g.x * screen.width, y: g.y * screen.height }) : null
        const bs = boxes()
        const near = gp ? nearestBox(gp, bs) : null
        const tb = bs.find((b) => b.id === cur!.id)
        const c = cur
        cur = null
        c.resolve({
          target: c.id,
          picked: near?.id ?? null,
          hit: near?.id === c.id,
          timeMs: Math.round(performance.now() - c.t0),
          gazeErrPx: gp && tb ? Math.round(Math.hypot(gp.x - (tb.x + tb.w / 2), gp.y - (tb.y + tb.h / 2))) : null,
          timedOut: false,
        })
      }
    }

    // frame source: the camera engine, or (synthetic camera) a scripted user who looks at the target and winks
    let simTimer: ReturnType<typeof setInterval> | null = null
    let off: (() => void) | null = null
    let simTarget: Vec2 | null = null
    let simWinkAt = 0
    let simSeed = 5000
    if (simulated) {
      simTimer = setInterval(() => {
        if (!simTarget) return
        const now = performance.now()
        const f = simulateGaze([simTarget], { msPerPoint: 60, saccadeMs: 1, seed: ++simSeed, noise: 1 }).frames[0]
        if (!f) return
        const inWink = now >= simWinkAt && now < simWinkAt + 300
        onFrame({ ...f, tsMs: now, blinkLeft: inWink ? 0.9 : f.blinkLeft, blinkRight: inWink ? 0.08 : f.blinkRight })
      }, 33)
    } else {
      off = engine.subscribe((f) => onFrame(f))
    }

    for (let i = 0; i < ORDER.length; i++) {
      if (!alive.current) break
      const id = ORDER[i]!
      setTrial(i)
      setFlash(null)
      setPromptLeft(1)
      const t0 = performance.now()
      const done = new Promise<GameTrial>((resolve) => {
        cur = { id, t0, resolve }
        setTimeout(() => {
          if (cur && cur.id === id && cur.t0 === t0) {
            cur = null
            resolve({ target: id, picked: null, hit: false, timeMs: null, gazeErrPx: null, timedOut: true })
          }
        }, TIMEOUT_MS)
      })
      if (simulated) {
        const r = refs.current[id]?.getBoundingClientRect()
        if (r) {
          const cx = r.left + r.width / 2 + (window.screenX - (display?.x ?? 0))
          const cy = r.top + r.height / 2 + (window.screenY - (display?.y ?? 0) + (window.outerHeight - window.innerHeight))
          simTarget = { x: cx / screen.width, y: cy / screen.height }
        }
        simWinkAt = t0 + 900 + ((i * 367) % 1300) // scripted reaction time, not a human's
      }
      const timer = setInterval(() => setPromptLeft(Math.max(0, 1 - (performance.now() - t0) / TIMEOUT_MS)), 100)
      const t = await done
      clearInterval(timer)
      trials.push(t)
      setFlash({ id: t.picked ?? t.target, hit: t.hit, text: t.timedOut ? `No wink in ${TIMEOUT_MS / 1000} s` : t.hit ? `${t.target} · ${(t.timeMs! / 1000).toFixed(1)} s` : `Picked ${t.picked ?? 'nothing'}, wanted ${t.target}` })
      simTarget = null
      await new Promise((r) => setTimeout(r, FEEDBACK_MS))
    }
    simTimer && clearInterval(simTimer)
    off?.()
    engine.driving = true
    if (!alive.current) return
    const rec = scoreGame(trials)
    setResult(rec)
    setFlash(null)
    setTrial(-1)
    setPhase('done')
    void recordGame(simulated, screen, rec)
  }

  const target = trial >= 0 ? ORDER[trial] : null
  return (
    <div className="mx-auto flex h-full max-w-[1100px] flex-col gap-3 px-6 pb-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow mb-1">Step 4 of 4 · Look and wink</div>
          <div className="headline min-h-[44px] text-4xl">
            {phase === 'intro' && 'Look at the button. Wink.'}
            {phase === 'play' && target && (<>Look at <em>{target}</em> and wink</>)}
            {phase === 'done' && result && `${result.hits} of ${result.total}`}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {simulated && <SimBadge />}
          {phase === 'play' && <Badge>{trial + 1} / {ORDER.length}</Badge>}
        </div>
      </div>

      <div ref={area} className="glass glass-md relative min-h-0 flex-1 overflow-hidden" style={{ borderRadius: 40 }}>
        {phase === 'play' && <div className="absolute left-0 top-0 h-[3px] bg-white/70" style={{ width: `${promptLeft * 100}%`, transition: 'width .1s linear' }} />}
        {BUTTONS.map((b) => {
          const hot = flash?.id === b.id
          return (
            <motion.div
              key={b.id}
              ref={(el) => {
                refs.current[b.id] = el
              }}
              animate={{ scale: hot ? 1.06 : 1 }}
              className={cn(
                'absolute flex items-center justify-center rounded-full border text-[15px] font-medium transition-colors',
                hot ? (flash!.hit ? 'border-white bg-white text-black' : 'border-white/70 bg-white/25 text-white') : 'border-white/25 bg-white/[0.07] text-white/85',
              )}
              style={{ left: `${b.x}%`, top: `${b.y}%`, width: b.w, height: b.h }}
            >
              {b.id}
            </motion.div>
          )
        })}
        {flash && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/25 bg-black/60 px-5 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-white/85 backdrop-blur-xl">{flash.text}</div>}
        {phase === 'intro' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/35 text-center backdrop-blur-[2px]">
            <p className="max-w-[560px] text-[17px] leading-relaxed text-white/75">Eight buttons, eight sizes. Glance names one; look at it and wink. It records which button your gaze was nearest to, how long you took, and what it missed. Gaze alone never clicks.</p>
            {!canWink && <p className="text-sm text-white/60">No wink worked in gesture training, so this game cannot run. You can retrain gestures from the dashboard.</p>}
            <div className="flex gap-3">
              <Button size="lg" onClick={() => void play()} disabled={!canWink}>Start</Button>
              <Button size="lg" variant="ghost" onClick={onSkip}>Skip</Button>
            </div>
          </div>
        )}
      </div>

      {phase === 'done' && result && (
        <Card className="gap-3 p-5">
          <div className="relative flex items-center gap-8">
            <Stat v={`${result.hits}/${result.total}`} k="right button" />
            <Stat v={result.medianMs === null ? '—' : `${(result.medianMs / 1000).toFixed(1)} s`} k="median time to wink" />
            <Stat v={String(result.misses)} k="misses" />
            <div className="ml-auto flex flex-wrap justify-end gap-1.5">
              {result.trials.map((t, i) => (
                <span key={i} title={t.hit ? 'hit' : `picked ${t.picked ?? 'nothing'}`} className={cn('rounded-full border px-2.5 py-1 font-mono text-[11px]', t.hit ? 'border-white bg-white text-black' : 'border-white/30 text-white/55 line-through')}>
                  {t.target}
                </span>
              ))}
            </div>
          </div>
          <div className="relative flex items-center gap-3">
            <Button onClick={onDone}>Finish setup</Button>
            <Button variant="glass" onClick={() => { setPhase('intro'); setResult(null) }}>Play again</Button>
            <span className="text-[12px] text-white/40">{simulated ? 'Synthetic face and a scripted winker: not a human result.' : 'Small buttons are hard for any webcam: a miss is data, not a failure.'}</span>
          </div>
        </Card>
      )}
    </div>
  )
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-4xl font-light tabular-nums leading-none">{v}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">{k}</div>
    </div>
  )
}
