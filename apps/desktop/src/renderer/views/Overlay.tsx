import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Keyboard, Mic, MousePointerClick, MousePointer2, MoveDown, MoveUp, Hand, Square } from 'lucide-react'
import type { OverlayState } from '../../shared/ipc'
import { ConfirmCard } from '../components/agent/ConfirmCard'

const EMPTY: OverlayState = { gaze: null, dwell: 0, ring: null, toast: null, radial: null, recording: false, paused: false, fake: false, dragging: false }

const ICONS: Record<string, typeof Mic> = {
  click: MousePointerClick,
  right: MousePointer2,
  drag: Hand,
  scroll_up: MoveUp,
  scroll_down: MoveDown,
  mic: Mic,
  type: Keyboard,
}

function Ring({ p, size = 60 }: { p: number; size?: number }) {
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className="-rotate-90" style={{ overflow: 'visible', filter: 'drop-shadow(0 0 6px rgba(255,255,255,.8))' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="2" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
    </svg>
  )
}

export function Overlay() {
  const [s, setS] = useState<OverlayState>(EMPTY)
  useEffect(() => window.glance.on('overlay:state', setS), [])
  // screenshot mode only: capturePage composites a transparent window on white, so paint a grey ground to see white UI
  useEffect(() => {
    void window.glance.invoke('app:info').then((i) => {
      if (i.screenshot) document.documentElement.style.setProperty('background', '#3a3a3a', 'important')
    })
  }, [])
  const { gaze, ring, toast, radial } = s

  return (
    <div className="pointer-events-none fixed inset-0 select-none overflow-hidden">
      {/* element ring + glass name tag */}
      <AnimatePresence>
        {ring && (
          <motion.div
            key={`${ring.x}-${ring.y}-${ring.name}`}
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="absolute"
            style={{ left: ring.x - 6, top: ring.y - 6, width: ring.w + 12, height: ring.h + 12 }}
          >
            <div className="absolute inset-0 rounded-[14px] border-[2px] border-white" style={{ boxShadow: '0 0 0 4px rgba(255,255,255,.14), 0 0 36px rgba(255,255,255,.55), inset 0 0 22px rgba(255,255,255,.12)' }} />
            {ring.name && (
              <div
                className="glass glass-dark glass-pill absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-4 py-1.5 font-mono text-[13px] tracking-[0.04em] text-white"
                style={{ top: ring.y < 60 ? ring.h + 22 : -42, borderRadius: 999 }}
              >
                <span className="relative">{ring.role ? <span className="mr-2 text-white/55">{ring.role}</span> : null}{ring.name.slice(0, 48)}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* radial menu */}
      <AnimatePresence>
        {radial && (
          <motion.div
            key="radial"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="absolute"
            style={{ left: radial.cx, top: radial.cy }}
          >
            <div className="glass glass-dark absolute -translate-x-1/2 -translate-y-1/2" style={{ width: 128, height: 128, borderRadius: 999 }}>
              <div className="relative flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.16em] text-white/60">look · hold</div>
            </div>
            {radial.items.map((it, i) => {
              const a = -Math.PI / 2 + (i * 2 * Math.PI) / radial.items.length
              const x = 150 * Math.cos(a)
              const y = 150 * Math.sin(a)
              const Icon = ICONS[it.id] ?? Square
              const hot = radial.hover === i
              return (
                <div key={it.id} className="absolute" style={{ left: x, top: y, transform: 'translate(-50%,-50%)' }}>
                  <div
                    className="glass glass-dark flex items-center justify-center transition-all duration-150"
                    style={{ width: hot ? 112 : 96, height: hot ? 112 : 96, borderRadius: 999, borderColor: hot ? 'rgba(255,255,255,.95)' : undefined, boxShadow: hot ? '0 0 40px rgba(255,255,255,.45), inset 0 1.5px 0 rgba(255,255,255,.7)' : undefined }}
                  >
                    <div className="relative flex flex-col items-center gap-1.5 text-white">
                      <Icon className="size-6" strokeWidth={1.6} />
                      <span className="text-[13px] font-medium tracking-tight">{it.label}</span>
                    </div>
                    {hot && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Ring p={radial.progress} size={hot ? 112 : 96} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* gaze point: white dot, soft halo, dwell ring */}
      {gaze && (
        <div className="absolute" style={{ left: 0, top: 0, transform: `translate3d(${gaze.x}px, ${gaze.y}px, 0)`, willChange: 'transform' }}>
          <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ width: 70, height: 70, background: 'radial-gradient(closest-side, rgba(255,255,255,.32), rgba(255,255,255,0))' }} />
          <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ width: 13, height: 13, boxShadow: '0 0 0 2px rgba(0,0,0,.55), 0 0 14px 2px rgba(255,255,255,.9)' }} />
          {s.dwell > 0.02 && !radial && (
            <div className="absolute -translate-x-1/2 -translate-y-1/2">
              <Ring p={s.dwell} />
            </div>
          )}
        </div>
      )}

      <ConfirmCard req={s.confirm} />

      {/* status pills */}
      <div className="absolute right-5 top-5 flex flex-col items-end gap-2">
        {s.recording && (
          <div className="glass glass-dark flex items-center gap-2.5 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.14em] text-white" style={{ borderRadius: 999 }}>
            <span className="relative flex size-2.5">
              <span className="pulse-ring absolute inset-0 rounded-full bg-white" />
              <span className="relative size-2.5 rounded-full bg-white" />
            </span>
            <span className="relative">Listening</span>
          </div>
        )}
        {s.paused && (
          <div className="glass glass-dark px-4 py-2 font-mono text-[12px] uppercase tracking-[0.14em] text-white" style={{ borderRadius: 999 }}>
            <span className="relative">Paused · Alt+Shift+P</span>
          </div>
        )}
        {s.dragging && (
          <div className="glass glass-dark px-4 py-2 font-mono text-[12px] uppercase tracking-[0.14em] text-white" style={{ borderRadius: 999 }}>
            <span className="relative">Dragging</span>
          </div>
        )}
        {s.fake && (
          <div className="rounded-full border border-white/25 bg-black/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/70">Fake gaze: mouse</div>
        )}
      </div>

      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="absolute bottom-14 left-1/2 -translate-x-1/2"
          >
            <div className="glass glass-dark px-7 py-3.5 text-center text-white" style={{ borderRadius: 999 }}>
              <div className="relative text-[17px] font-medium tracking-tight">{toast.text}</div>
              {toast.sub && <div className="relative mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/60">{toast.sub}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
