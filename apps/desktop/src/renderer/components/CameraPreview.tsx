import { useEffect, useRef } from 'react'
import { engine, type Landmark } from '../lib/engine'
import { cn } from '@glance/ui/lib/utils'

// MediaPipe mesh: iris rings (468..472 left-in-image, 473..477) and the eye corners / lids.
const IRIS_A = [468, 469, 470, 471, 472]
const IRIS_B = [473, 474, 475, 476, 477]
const EYE_RING_A = [33, 160, 158, 133, 153, 144]
const EYE_RING_B = [362, 385, 387, 263, 373, 380]

/** Mirrored live preview with the iris overlay. The mirror is display-only: the pipeline sees the raw image. */
export function CameraPreview({ className, label = true }: { className?: string; label?: boolean }) {
  const vref = useRef<HTMLVideoElement>(null)
  const cref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const v = vref.current
    if (v && engine.stream) {
      v.srcObject = engine.stream
      void v.play().catch(() => {})
    }
    const t = setInterval(() => {
      if (v && !v.srcObject && engine.stream) {
        v.srcObject = engine.stream
        void v.play().catch(() => {})
      }
    }, 500)
    const off = engine.subscribe((_f, lms) => draw(cref.current, lms))
    return () => {
      clearInterval(t)
      off()
    }
  }, [])

  return (
    <div className={cn('relative overflow-hidden rounded-[28px] border border-white/20 bg-black', className)} style={{ aspectRatio: '4 / 3' }}>
      <video ref={vref} muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-80 grayscale" style={{ transform: 'scaleX(-1)' }} />
      <canvas ref={cref} width={640} height={480} className="absolute inset-0 h-full w-full" style={{ transform: 'scaleX(-1)' }} />
      {label && <div className="absolute bottom-2.5 left-3.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/70">Local only · never leaves this Mac</div>}
    </div>
  )
}

function draw(c: HTMLCanvasElement | null, lms: Landmark[] | null): void {
  if (!c) return
  const g = c.getContext('2d')
  if (!g) return
  g.clearRect(0, 0, c.width, c.height)
  if (!lms) return
  const W = c.width
  const H = c.height
  const pt = (i: number) => lms[i] && ({ x: lms[i]!.x * W, y: lms[i]!.y * H })
  g.lineWidth = 1.5
  for (const [ring, iris] of [[EYE_RING_A, IRIS_A], [EYE_RING_B, IRIS_B]] as const) {
    g.strokeStyle = 'rgba(255,255,255,.55)'
    g.beginPath()
    ring.forEach((i, k) => {
      const p = pt(i)
      if (p) (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))
    })
    g.closePath()
    g.stroke()
    const c0 = pt(iris[0]!)
    const e = pt(iris[1]!)
    if (c0 && e) {
      const r = Math.hypot(e.x - c0.x, e.y - c0.y)
      g.strokeStyle = '#fff'
      g.lineWidth = 2
      g.shadowColor = 'rgba(255,255,255,.9)'
      g.shadowBlur = 10
      g.beginPath()
      g.arc(c0.x, c0.y, r, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = '#fff'
      g.beginPath()
      g.arc(c0.x, c0.y, 2.5, 0, Math.PI * 2)
      g.fill()
      g.shadowBlur = 0
    }
  }
}
