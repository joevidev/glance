"use client"

// The in-browser demo. Everything here runs in the visitor's browser: no video, gaze or calibration is sent anywhere.
// Camera path = the same @glance/gaze code the desktop app uses (MediaPipe iris + ridge calibration + One Euro smoothing + gestures).
// It has been verified with synthetic frames and a fake camera only, never with a real face (see the note on the page).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  calibrationPoints,
  createFaceLandmarker,
  DeadZone,
  frameFromResult,
  GazeCalibration,
  GazeTracker,
  GestureDetector,
  type FaceLandmarkerHandle,
  type GazeFrame,
  type Vec2,
} from "@glance/gaze"
import caseData from "../data/try-cases.json"
import { Glass } from "./bits"

// wasm from a CDN pinned to the installed package version, the face model from Google's MediaPipe bucket
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm"
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

const CARDS = [
  "Re: Demo tomorrow at 3",
  "Re: Invoice #4821",
  "Weekly update",
  "Lunch on Friday?",
  "Your receipt",
  "Flight confirmation",
  "Standup notes",
  "Welcome to Glance",
]

/** Extra, off-grid points for the "fine-tune" round (none sits on the 9-point grid). */
const REFINE_POINTS: Vec2[] = [
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.25, y: 0.75 },
  { x: 0.75, y: 0.75 },
  { x: 0.5, y: 0.18 },
  { x: 0.5, y: 0.82 },
]

/** Features 3..8 are head pose and face box. Zeroed (as in the desktop app) so the cursor follows the eyes, not the head. */
function neutralizeHead(frame: GazeFrame | null): GazeFrame | null {
  if (!frame) return frame
  const f = frame.features.slice()
  for (let i = 3; i <= 8; i++) f[i] = 0
  return { ...frame, features: f }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Waits `ms`, but returns early (false) as soon as `cancel.current` turns true, so Esc responds at once. */
async function waitOrCancel(ms: number, cancel: { current: boolean }): Promise<boolean> {
  for (let t = 0; t < ms; t += 50) {
    if (cancel.current) return false
    await sleep(50)
  }
  return !cancel.current
}
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())

type Box = { x: number; y: number; w: number; h: number }
function boxDist(px: number, py: number, b: Box) {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.w))
  const dy = Math.max(b.y - py, 0, py - (b.y + b.h))
  return Math.hypot(dx, dy)
}

type Phase = "idle" | "loading" | "ready" | "calibrating" | "live" | "error"

export function Playground() {
  const [mode, setMode] = useState<"mouse" | "camera">("mouse")
  const [sigma, setSigma] = useState(120)
  const [nearLabel, setNearLabel] = useState("-")
  const [tally, setTally] = useState({ right: 0, total: 0 })
  const [phase, setPhase] = useState<Phase>("idle")
  const [msg, setMsg] = useState("")
  const [overlay, setOverlay] = useState<{ p: Vec2; title: string; sub: string } | null>(null)
  const [loo, setLoo] = useState<{ first: number | null; refined: number | null }>({ first: null, refined: null })
  const [winks, setWinks] = useState(0)
  const [faceSeen, setFaceSeen] = useState(false)

  const dotRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const nearRef = useRef<number | null>(null)
  const offsetRef = useRef<Vec2>({ x: 0, y: 0 })
  const sigmaRef = useRef(sigma)
  sigmaRef.current = sigma
  const modeRef = useRef(mode)
  modeRef.current = mode

  // camera engine refs
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lmRef = useRef<FaceLandmarkerHandle | null>(null)
  const calibRef = useRef(new GazeCalibration())
  const trackerRef = useRef<GazeTracker | null>(null)
  const gesturesRef = useRef<GestureDetector | null>(null)
  const deadRef = useRef(new DeadZone(30))
  const collectRef = useRef<Vec2 | null>(null)
  const cancelRef = useRef(false)
  const phaseRef = useRef<Phase>("idle")
  phaseRef.current = phase
  const lastFaceRef = useRef(0)
  const runningRef = useRef(false)

  const moveDot = useCallback((x: number, y: number, visible = true) => {
    const d = dotRef.current
    if (!d) return
    d.style.opacity = visible ? "1" : "0"
    d.style.transform = `translate(${x}px, ${y}px)`
  }, [])

  /** Highlight the card nearest to the gaze point (box distance, 0 inside), the same geometry baseline as the benchmark. */
  const updateNearest = useCallback((x: number, y: number) => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-gid]"))
    let best: HTMLElement | null = null
    let bd = Infinity
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const d = boxDist(x, y, { x: r.left, y: r.top, w: r.width, h: r.height })
      if (d < bd) {
        bd = d
        best = el
      }
    }
    for (const el of els) {
      if (el === best) el.setAttribute("data-near", "1")
      else el.removeAttribute("data-near")
    }
    const id = best ? Number(best.dataset.gid) : null
    if (id !== nearRef.current) {
      nearRef.current = id
      setNearLabel(id === null ? "-" : CARDS[id]!)
    }
  }, [])

  // ---------- mouse mode: the mouse is the "eyes", plus webcam-sized noise that drifts like real gaze error
  useEffect(() => {
    if (mode !== "mouse") return
    let mx = window.innerWidth / 2
    let my = window.innerHeight / 2
    const resample = () => {
      offsetRef.current = { x: gauss() * sigmaRef.current, y: gauss() * sigmaRef.current }
    }
    resample()
    const apply = () => {
      const gx = mx + offsetRef.current.x
      const gy = my + offsetRef.current.y
      const r = areaRef.current?.getBoundingClientRect()
      const inside = !!r && mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom
      moveDot(gx, gy, inside)
      if (inside) updateNearest(gx, gy)
    }
    const onMove = (e: MouseEvent) => {
      mx = e.clientX
      my = e.clientY
      apply()
    }
    const tick = setInterval(() => {
      resample()
      apply()
    }, 1400)
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-gid]")
      if (!el) return
      const clicked = Number(el.dataset.gid)
      setTally((t) => ({ right: t.right + (clicked === nearRef.current ? 1 : 0), total: t.total + 1 }))
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("scroll", apply, { passive: true })
    window.addEventListener("click", onClick)
    apply()
    return () => {
      clearInterval(tick)
      window.removeEventListener("scroll", apply)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("click", onClick)
      moveDot(0, 0, false)
    }
  }, [mode, moveDot, updateNearest])

  useEffect(() => {
    if (mode !== "mouse") return
    offsetRef.current = { x: gauss() * sigma, y: gauss() * sigma }
  }, [sigma, mode])

  // ---------- camera mode
  const drive = useCallback(
    (frame: GazeFrame | null, now: number) => {
      if (!frame) return
      lastFaceRef.current = now
      // calibration collection
      const target = collectRef.current
      if (target) {
        calibRef.current.addSample(frame, target)
        return
      }
      if (phaseRef.current !== "live") return
      const tr = trackerRef.current
      if (tr) {
        const out = tr.update(frame)
        if (out.point && out.pointPx) {
          const z = out.held ? out.pointPx : deadRef.current.apply(out.pointPx)
          moveDot(z.x, z.y)
          updateNearest(z.x, z.y)
        }
      }
      const g = gesturesRef.current
      if (g) {
        for (const ev of g.update(frame)) {
          if (ev.type === "wink_left" || ev.type === "double_wink_left") {
            const el = document.querySelector<HTMLElement>("[data-gid][data-near='1']")
            if (el) {
              el.click()
              setWinks((n) => n + 1)
            }
          }
        }
      }
    },
    [moveDot, updateNearest],
  )

  const loop = useCallback(() => {
    const v = videoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }) | null
    if (!v || !runningRef.current) return
    const step = () => {
      if (!runningRef.current) return
      const lm = lmRef.current
      if (lm && v.readyState >= 2 && v.videoWidth > 0) {
        const now = performance.now()
        const res = lm.detect(v, now)
        const frame = neutralizeHead(frameFromResult(res, now, { aspect: v.videoWidth / v.videoHeight }))
        drive(frame, now)
      }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step)
      else setTimeout(step, 33)
    }
    step()
  }, [drive])

  useEffect(() => {
    const t = setInterval(() => setFaceSeen(performance.now() - lastFaceRef.current < 600), 300)
    return () => clearInterval(t)
  }, [])

  const stopCamera = useCallback(() => {
    runningRef.current = false
    collectRef.current = null
    cancelRef.current = true
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    lmRef.current?.close()
    lmRef.current = null
    trackerRef.current = null
    gesturesRef.current = null
    setOverlay(null)
    setPhase("idle")
    moveDot(0, 0, false)
  }, [moveDot])

  useEffect(() => stopCamera, [stopCamera])

  const startCamera = useCallback(async () => {
    setMsg("")
    setPhase("loading")
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser has no camera API (use https or localhost).")
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false })
      streamRef.current = stream
      const v = document.createElement("video")
      v.muted = true
      v.playsInline = true
      v.srcObject = stream
      await v.play()
      videoRef.current = v
      setMsg("Loading the face tracker (about 4 MB, once)...")
      lmRef.current = await createFaceLandmarker({ wasmRoot: WASM_ROOT, modelUrl: MODEL_URL })
      runningRef.current = true
      cancelRef.current = false
      setMsg("")
      setPhase("ready")
      loop()
    } catch (e) {
      stopCamera()
      setPhase("error")
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }, [loop, stopCamera])

  const runPoints = useCallback(async (pts: Vec2[], title: string): Promise<boolean> => {
    cancelRef.current = false
    for (let i = 0; i < pts.length; i++) {
      if (cancelRef.current) break
      const p = pts[i]!
      setOverlay({
        p: { x: p.x * window.innerWidth, y: p.y * window.innerHeight },
        title,
        sub: `Point ${i + 1} of ${pts.length}. Look at the dot and keep your head still. Esc cancels.`,
      })
      if (!(await waitOrCancel(900, cancelRef))) break
      collectRef.current = p
      const done = await waitOrCancel(1100, cancelRef)
      collectRef.current = null
      if (!done) break
    }
    setOverlay(null)
    return !cancelRef.current
  }, [])

  const finishFit = useCallback((which: "first" | "refined") => {
    const c = calibRef.current
    if (c.sampleCount < 40) {
      setMsg(`Only ${c.sampleCount} usable camera frames were collected. Is your face in view and lit from the front? Try again.`)
      c.clear()
      setPhase("ready")
      return false
    }
    const fit = c.fit({ width: window.innerWidth, height: window.innerHeight })
    if (!fit.ok) {
      setMsg("The fit failed (too little variation between the dots). Try again, looking at each dot.")
      c.clear()
      setPhase("ready")
      return false
    }
    setLoo((l) => ({ ...l, [which]: Math.round(fit.looErrorPx) }))
    trackerRef.current = new GazeTracker(c, { width: window.innerWidth, height: window.innerHeight }, { fixation: { windowMs: 400 } })
    gesturesRef.current = new GestureDetector()
    deadRef.current.reset()
    setPhase("live")
    return true
  }, [])

  const calibrate = useCallback(async () => {
    setMsg("")
    calibRef.current.clear()
    setLoo({ first: null, refined: null })
    setPhase("calibrating")
    const ok = await runPoints(calibrationPoints(9), "Calibrating your eyes")
    if (!ok) {
      calibRef.current.clear()
      setPhase("ready")
      return
    }
    finishFit("first")
  }, [finishFit, runPoints])

  const refine = useCallback(async () => {
    setMsg("")
    setPhase("calibrating")
    const ok = await runPoints(REFINE_POINTS, "Fine-tuning your gaze mapping")
    if (!ok) {
      setPhase("live")
      return
    }
    finishFit("refined")
  }, [finishFit, runPoints])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current = true
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const camBusy = phase === "loading" || phase === "calibrating"

  return (
    <div ref={areaRef}>
      {/* the gaze dot, shared by both modes */}
      <div
        ref={dotRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-50 opacity-0"
        style={{ willChange: "transform" }}
      >
        <div className="gaze-dot" />
      </div>

      {overlay && (
        <div className="fixed inset-0 z-[60] bg-black" role="dialog" aria-label={overlay.title}>
          <div className="absolute left-1/2 top-8 w-[min(34rem,90vw)] -translate-x-1/2 text-center">
            <div className="eyebrow">{overlay.title}</div>
            <p className="mt-2 text-sm text-w60">{overlay.sub}</p>
          </div>
          <div
            className="calib-dot absolute"
            style={{ left: overlay.p.x, top: overlay.p.y }}
          />
        </div>
      )}

      <Glass className="p-5 sm:p-8">
        <div className="relative z-10 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-white/20 p-1 text-sm" role="tablist" aria-label="Input mode">
            {(["mouse", "camera"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  if (m === "mouse") stopCamera()
                  setMode(m)
                }}
                className={`rounded-full px-4 py-1.5 transition ${mode === m ? "bg-white text-black" : "text-w80 hover:text-white"}`}
              >
                {m === "mouse" ? "Mouse as eyes" : "My camera"}
              </button>
            ))}
          </div>
          <span className="mono text-xs tracking-wider text-w60">{mode === "mouse" ? "no camera needed" : "experimental"}</span>
        </div>

        {mode === "mouse" ? (
          <div className="relative z-10 mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <p className="max-w-2xl text-w80">
              Move your mouse over the cards. The white dot is where a webcam <em>would think</em> you are looking: your mouse plus a drifting
              error of the size published for webcam trackers. The outlined card is what the nearest-element baseline would pick. Click the card
              you mean and see how often the baseline is right.
            </p>
            <label className="grid gap-1 text-sm text-w80">
              <span className="mono text-xs tracking-wider text-w60">GAZE ERROR (SIGMA) {sigma} PX</span>
              <input
                type="range"
                min={0}
                max={200}
                step={20}
                value={sigma}
                onChange={(e) => setSigma(Number(e.target.value))}
                className="w-56 accent-white"
                aria-label="Gaze error in pixels"
              />
            </label>
          </div>
        ) : (
          <div className="relative z-10 mt-5">
            <p className="max-w-3xl text-w80">
              Your camera video stays in this tab: the face model runs locally in your browser and nothing is uploaded. Calibrate (nine dots, about
              20 seconds), then the white dot follows your eyes and a <b className="font-semibold text-white">left wink</b> clicks the outlined card.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {phase === "idle" || phase === "error" ? (
                <button className="glass glass-pill px-5 py-2.5 text-sm font-medium" onClick={startCamera}>
                  <span className="relative z-10">Start camera</span>
                </button>
              ) : (
                <button className="pill" onClick={stopCamera}>
                  Stop camera
                </button>
              )}
              <button
                className="glass glass-pill px-5 py-2.5 text-sm font-medium disabled:opacity-40"
                disabled={phase !== "ready" && phase !== "live"}
                onClick={calibrate}
              >
                <span className="relative z-10">{loo.first === null ? "Calibrate my eyes" : "Recalibrate"}</span>
              </button>
              <button
                className="glass glass-pill px-5 py-2.5 text-sm font-medium disabled:opacity-40"
                disabled={phase !== "live" || loo.first === null}
                onClick={refine}
                title="Adds six fresh points to your calibration and fits again on all of them"
              >
                <span className="relative z-10">Fine-tune my gaze (6 more points)</span>
              </button>
              <span className="mono text-xs tracking-wider text-w60">
                {phase === "loading" && "LOADING"}
                {phase === "ready" && (faceSeen ? "FACE FOUND" : "NO FACE YET")}
                {phase === "live" && (faceSeen ? "TRACKING" : "NO FACE")}
                {phase === "calibrating" && "CALIBRATING"}
              </span>
            </div>
            {(loo.first !== null || loo.refined !== null) && (
              <p className="mt-3 text-sm text-w80">
                Leave-one-out error on your calibration points:{" "}
                <b className="font-semibold text-white">{loo.first} px</b>
                {loo.refined !== null && (
                  <>
                    {" "}
                    before fine-tune, <b className="font-semibold text-white">{loo.refined} px</b> after
                  </>
                )}
                . This is optimistic: real use is usually worse (webcam gaze is typically 100 to 200 px off).
              </p>
            )}
            {msg && <p className="mt-3 text-sm text-w80" role="status">{msg}</p>}
            {winks > 0 && <p className="mono mt-2 text-xs tracking-wider text-w60">WINK CLICKS: {winks}</p>}
          </div>
        )}
      </Glass>

      <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Demo inbox">
        {CARDS.map((t, i) => (
          <button
            key={t}
            data-gid={i}
            onClick={(e) => {
              const el = e.currentTarget
              el.setAttribute("data-opened", "1")
              setTimeout(() => el.removeAttribute("data-opened"), 600)
            }}
            className="demo-card flex h-16 items-center justify-between rounded-3xl border border-white/10 bg-white/[0.07] px-5 text-left text-lg font-medium tracking-[-0.015em]"
          >
            <span className="truncate">{t}</span>
            <span className="mono ml-3 text-[0.65rem] tracking-wider text-w40">OPEN</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-w80" aria-live="polite">
        <span>
          Nearest to the gaze point: <b className="font-semibold text-white">{nearLabel}</b>
        </span>
        {mode === "mouse" && (
          <span>
            Baseline right on your clicks: <b className="font-semibold text-white">{tally.right} of {tally.total}</b>
          </span>
        )}
      </div>
      <p className="mt-3 max-w-3xl text-sm text-w40">
        This page can only show the geometry baseline. The model step (gaze + what you say + the page's elements, resolved to one element) needs an API
        key, so it runs in the desktop app and in the benchmark below, not on a static website.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

type CaseT = (typeof caseData)[number]

const SYSTEM_ROWS: { key: keyof CaseT["picks"]; label: string }[] = [
  { key: "open_base", label: "Open model (glm-5p3)" },
  { key: "flash", label: "Open model, untrained flash" },
  { key: "frontier", label: "Frontier (gpt-6-astra)" },
  { key: "lora", label: "Open model + our LoRA" },
]

export function CaseExplorer() {
  const cases = caseData as CaseT[]
  const [idx, setIdx] = useState(0)
  const [drag, setDrag] = useState<Vec2 | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const c = cases[idx]!
  const byId = useMemo(() => new Map(c.elements.map((e) => [e.id, e])), [c])
  const gaze = drag ?? c.gaze
  const nearest = useMemo(() => {
    let best = -1
    let bd = Infinity
    for (const e of c.elements) {
      const d = boxDist(gaze.x, gaze.y, e.box)
      if (d < bd) {
        bd = d
        best = e.id
      }
    }
    return best
  }, [c, gaze.x, gaze.y])
  const name = (id: number | null | undefined) => (id === null || id === undefined ? "no answer" : (byId.get(id)?.name || `(${byId.get(id)?.role ?? "?"}, no name)`))

  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    if (!m) return null
    const p = pt.matrixTransform(m.inverse())
    return { x: Math.max(0, Math.min(c.viewport.w, p.x)), y: Math.max(0, Math.min(c.viewport.h, p.y)) }
  }

  const row = (label: string, id: number | null, note?: string) => {
    const ok = id !== null && id === c.answer
    return (
      <tr className="rowline align-top" key={label}>
        <td className="px-3 py-2.5 text-w80">{label}</td>
        <td className="px-3 py-2.5">
          {name(id)} {note && <span className="mono ml-1 text-[0.65rem] tracking-wider text-w40">{note}</span>}
        </td>
        <td className="px-3 py-2.5 font-semibold">{ok ? "right" : "wrong"}</td>
      </tr>
    )
  }

  return (
    <Glass className="p-5 sm:p-8">
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
        <div className="mono text-xs tracking-wider text-w60">
          CASE {idx + 1} OF {cases.length} · {c.site.toUpperCase()} · GAZE ERROR SIGMA {c.sigma} PX
        </div>
        <div className="flex gap-2">
          <button className="pill" onClick={() => { setIdx((i) => (i + cases.length - 1) % cases.length); setDrag(null) }}>Prev</button>
          <button className="pill" onClick={() => { setIdx((i) => (i + 1) % cases.length); setDrag(null) }}>Next</button>
        </div>
      </div>
      <p className="relative z-10 mt-4 text-xl font-medium tracking-[-0.02em]">
        Command: <span className="text-w80">&ldquo;{c.command}&rdquo;</span>
      </p>
      <div className="relative z-10 mt-4 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${c.viewport.w} ${c.viewport.h}`}
          className="w-full touch-none rounded-2xl border border-white/15 bg-black/40"
          onPointerDown={(e) => {
            ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
            const p = toSvg(e)
            if (p) setDrag(p)
          }}
          onPointerMove={(e) => {
            if (e.buttons) {
              const p = toSvg(e)
              if (p) setDrag(p)
            }
          }}
          role="img"
          aria-label={`Page elements for case ${idx + 1}. The true target is ${name(c.answer)}. Drag to move the gaze dot.`}
        >
          {c.elements.map((e) => (
            <rect
              key={e.id}
              x={e.box.x}
              y={e.box.y}
              width={e.box.w}
              height={e.box.h}
              rx={3}
              fill={e.id === c.answer ? "rgba(255,255,255,.38)" : "rgba(255,255,255,.05)"}
              stroke={e.id === nearest ? "#fff" : "rgba(255,255,255,.22)"}
              strokeWidth={e.id === nearest ? 3 : 1}
              strokeDasharray={e.id === nearest && e.id !== c.answer ? "6 4" : undefined}
            />
          ))}
          <circle cx={gaze.x} cy={gaze.y} r={c.sigma} fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.7)" strokeDasharray="8 6" strokeWidth={2} />
          <circle cx={gaze.x} cy={gaze.y} r={9} fill="#fff" />
        </svg>
        <div>
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="eyebrow">
                <th className="px-3 py-2 font-normal">System</th>
                <th className="px-3 py-2 font-normal">Picked</th>
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              <tr className="rowline">
                <td className="px-3 py-2.5 text-w80">The right answer</td>
                <td className="px-3 py-2.5 font-semibold" colSpan={2}>{name(c.answer)}</td>
              </tr>
              {row("Nearest element to the gaze", nearest, drag ? "LIVE" : undefined)}
              {SYSTEM_ROWS.map((s) => row(s.label, c.picks[s.key] ?? null, drag ? "FOR THE ORIGINAL DOT" : undefined))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="relative z-10 mt-4 text-sm text-w60">
        White box = the right element. Dashed circle = the simulated gaze error. <b className="font-semibold text-white">Drag the dot</b> to see the nearest
        element change live; the model rows are the saved answers for the original dot and do not change. These 24 cases are every 15th case of the locked
        test set, not hand-picked, and they say nothing about overall accuracy: that is on the results page (360 cases).
      </p>
    </Glass>
  )
}
