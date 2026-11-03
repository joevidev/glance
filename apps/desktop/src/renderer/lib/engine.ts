// The tracker engine: camera -> MediaPipe -> GazeFrame -> (calibrated gaze, gestures) -> main process.
// Lives in the main window's renderer; backgroundThrottling is off and the loop does not depend on rAF.
import {
  simulateGaze,
  GazeCalibration,
  GazeTracker,
  DeadZone,
  GestureDetector,
  createFaceLandmarker,
  frameFromResult,
  type FaceLandmarkerHandle,
  type GazeFrame,
  type GestureThresholds,
} from '@glance/gaze'
import type { EngineStatus } from '../../shared/ipc'
import { trackerOpts } from './profile-stats'

export type Landmark = { x: number; y: number }
export type FrameListener = (frame: GazeFrame | null, landmarks: Landmark[] | null) => void

export interface SavedCalibration {
  version: 1
  calib: unknown
  screen: { width: number; height: number }
  thresholds: GestureThresholds
  works: { winkLeft: boolean; winkRight: boolean; mouthOpen: boolean; browsUp: boolean }
  separation?: Record<string, number>
  swapEyes: boolean
  looErrorPx: number
  savedAt: string
}

const WASM_ROOT = 'glance-asset://wasm'
const MODEL_URL = 'glance-asset://model/face_landmarker.task'

/** Radius (px) inside which gaze micro-movements are ignored. Webcam gaze is 100+ px off anyway, so 30 px costs nothing. */
const DEAD_ZONE_PX = 30
/** An eye closing past this score freezes the cursor, and it stays frozen this long after, while the iris landmarks recover. */
const BLINK_FREEZE_MIN = 0.45 // never below this: a relaxed or squinting eye can score 0.3 and must not freeze the cursor
const BLINK_HOLD_MS = 200
/** A freeze never lasts longer than this in one go, so a mis-set threshold can slow the cursor but never pin it. */
const MAX_FREEZE_MS = 1500
const OPEN_LOOKBACK_MS = 150
/** Features 3..8 are head pose and face box (yaw, pitch, roll, cx, cy, size). Zeroed for calibration: with 9 dots and a still head they
 * carry only noise, standardisation gives them full weight, and the cursor then follows head movement instead of the eyes.
 * Gestures read frame.head, not these, so scroll is unaffected. */
function neutralizeHead(frame: GazeFrame | null): GazeFrame | null {
  if (!frame) return frame
  const f = frame.features.slice()
  for (let i = 3; i <= 8; i++) f[i] = 0
  return { ...frame, features: f }
}

class Engine {
  video = document.createElement('video')
  stream: MediaStream | null = null
  private lm: FaceLandmarkerHandle | null = null
  private listeners = new Set<FrameListener>()
  private statusListeners = new Set<(s: EngineStatus) => void>()
  status: EngineStatus = { state: 'idle', fps: 0 }
  private running = false
  private starting: Promise<void> | null = null
  private lastVideoTime = -1
  private lastProcess = 0
  private frames: number[] = []

  // live control state
  private tracker: GazeTracker | null = null
  /** Dead zone with a trailing anchor: the emitted point only moves once the gaze leaves a small radius. */
  private deadZone = new DeadZone(DEAD_ZONE_PX)
  private lastOut: { nx: number; ny: number } | null = null
  /** Blink score above which the cursor freezes; taken from this user's calibrated 'eye closed' level. */
  private blinkFreeze = BLINK_FREEZE_MIN
  private freezeStart = 0
  /** Until this time (ms) the cursor stays frozen: the iris landmarks are wrong while a lid closes and for a moment after it opens. */
  private blinkUntil = 0
  private gestures: GestureDetector | null = null
  private works = { winkLeft: true, winkRight: true, mouthOpen: true, browsUp: true }
  private swapEyes = false
  /** Send gaze/gestures to the main process (off during calibration). */
  driving = false
  invertScroll = false
  private lastScrollTs = 0
  private prevDwell = 0

  constructor() {
    this.video.muted = true
    this.video.playsInline = true
    this.video.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;opacity:0;pointer-events:none'
    document.body.appendChild(this.video)
    try {
      this.invertScroll = localStorage.getItem('glance.invertScroll') === '1'
    } catch {
      /* ignore */
    }
  }

  private setStatus(s: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...s }
    window.glance.send('engine:status', this.status)
    for (const l of this.statusListeners) l(this.status)
  }
  onStatus(cb: (s: EngineStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }
  subscribe(cb: FrameListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  setInvertScroll(v: boolean): void {
    this.invertScroll = v
    try {
      localStorage.setItem('glance.invertScroll', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  applyCalibration(saved: SavedCalibration | null): void {
    if (!saved) {
      this.tracker = null
      this.gestures = null
      return
    }
    const calib = GazeCalibration.fromJSON(saved.calib)
    this.deadZone.reset()
    this.lastOut = null
    this.freezeStart = 0
    this.tracker = calib.isFitted ? new GazeTracker(calib, saved.screen, trackerOpts) : null
    this.gestures = new GestureDetector(saved.thresholds)
    this.blinkFreeze = Math.max(BLINK_FREEZE_MIN, saved.thresholds.blinkClosed ?? 0)
    this.works = saved.works
    this.swapEyes = saved.swapEyes
  }
  get calibrated(): boolean {
    return !!this.tracker
  }

  start(): Promise<void> {
    if (this.running) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = this.doStart().finally(() => (this.starting = null))
    return this.starting
  }

  private async doStart(): Promise<void> {
    this.setStatus({ state: 'loading', message: 'Starting the camera' })
    try {
      const perm = await window.glance.invoke('perm:media', { kind: 'camera' })
      if (perm !== 'granted') throw new Error(`Camera permission: ${perm}. Allow Glance (Electron) in System Settings > Privacy & Security > Camera.`)
      // wait for the face model (downloaded once)
      for (let i = 0; i < 120; i++) {
        const a = await window.glance.invoke('assets:ready')
        if (a.ready) break
        if (a.error) throw new Error('Face model missing: ' + a.error)
        this.setStatus({ state: 'loading', message: 'Downloading the face model (once)' })
        await new Promise((r) => setTimeout(r, 1000))
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false })
      this.video.srcObject = this.stream
      await this.video.play()
      this.setStatus({ state: 'loading', message: 'Loading the face tracker' })
      this.lm = await createFaceLandmarker({ wasmRoot: WASM_ROOT, modelUrl: MODEL_URL })
      this.running = true
      this.setStatus({ state: 'no-face', message: undefined })
      this.loop()
      // watchdog: if the page is throttled and video callbacks stall, keep ticking
      setInterval(() => {
        if (performance.now() - this.lastProcess > 200) this.tick()
      }, 100)
    } catch (e) {
      this.setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  private loop = (): void => {
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
    if (v.requestVideoFrameCallback) {
      v.requestVideoFrameCallback(() => {
        this.tick()
        this.loop()
      })
    } else {
      setTimeout(() => {
        this.tick()
        this.loop()
      }, 33)
    }
  }

  private tick(): void {
    if (!this.running || !this.lm) return
    const v = this.video
    if (v.readyState < 2 || v.videoWidth === 0) return
    if (v.currentTime === this.lastVideoTime && performance.now() - this.lastProcess < 400) return
    this.lastVideoTime = v.currentTime
    const now = performance.now()
    this.lastProcess = now
    const res = this.lm.detect(v, now)
    const frame = neutralizeHead(frameFromResult(res, now, { aspect: v.videoWidth / v.videoHeight }))
    const lms = res.faceLandmarks?.[0] ?? null
    this.frames.push(now)
    while (this.frames.length && now - this.frames[0]! > 1000) this.frames.shift()
    const fps = this.frames.length
    const st = frame ? 'tracking' : 'no-face'
    if (st !== this.status.state || Math.abs(fps - this.status.fps) >= 3) this.setStatus({ state: st, fps })
    for (const l of this.listeners) l(frame, lms)
    if (this.driving) this.drive(frame, now)
  }

  private drive(frame: GazeFrame | null, now: number): void {
    if (!frame) {
      window.glance.send('gaze:frame', { ts: now, nx: null, ny: null, speed: 0, dwell: 0, held: false })
      return
    }
    if (this.tracker) {
      // Decide the freeze BEFORE the tracker sees the frame: the iris landmarks are garbage while a lid closes, and a
      // garbage frame would otherwise enter the fixation window. Triggers: a blink/wink score, or the eyelid opening
      // (feature 9) dropping sharply, which starts a little before the blink score rises.
      const closing = Math.max(frame.blinkLeft, frame.blinkRight) > this.blinkFreeze
      if (closing) {
        if (this.freezeStart === 0) this.freezeStart = now
        if (now - this.freezeStart <= MAX_FREEZE_MS) {
          if (now >= this.blinkUntil) this.tracker.discardRecent(OPEN_LOOKBACK_MS)
          this.blinkUntil = now + BLINK_HOLD_MS
        }
      } else {
        this.freezeStart = 0
      }
      if (now < this.blinkUntil && this.lastOut) {
        window.glance.send('gaze:frame', { ts: now, nx: this.lastOut.nx, ny: this.lastOut.ny, speed: 0, dwell: 0, held: true })
      } else {
        const out = this.tracker.update(frame)
        let nx = out.point?.x ?? null
        let ny = out.point?.y ?? null
        if (out.point && out.pointPx && !out.held) {
          const w = out.pointPx.x / Math.max(1e-6, out.point.x)
          const h = out.pointPx.y / Math.max(1e-6, out.point.y)
          const z = this.deadZone.apply(out.pointPx)
          nx = z.x / w
          ny = z.y / h
        }
        if (nx !== null && ny !== null) this.lastOut = { nx, ny }
        window.glance.send('gaze:frame', {
          ts: now,
          nx,
          ny,
          speed: out.speedPxPerS,
          dwell: out.dwell.progress,
          held: out.held,
        })
      }
    }
    if (this.gestures) {
      const gf = this.swapEyes ? { ...frame, blinkLeft: frame.blinkRight, blinkRight: frame.blinkLeft } : frame
      for (const ev of this.gestures.update(gf)) {
        switch (ev.type) {
          case 'wink_left':
          case 'double_wink_left':
            if (this.works.winkLeft) window.glance.send('gesture', { type: ev.type })
            break
          case 'wink_right':
          case 'double_wink_right':
            if (this.works.winkRight) window.glance.send('gesture', { type: ev.type })
            break
          case 'mouth_open_start':
          case 'mouth_open_end':
            if (this.works.mouthOpen) window.glance.send('gesture', { type: ev.type })
            break
          case 'brows_up':
            window.glance.send('gesture', { type: 'brows_up' })
            break
          case 'eyes_closed_long':
            window.glance.send('gesture', { type: 'eyes_closed_long' })
            break
          case 'scroll': {
            if (!this.works.browsUp) break
            const dt = this.lastScrollTs ? Math.min(100, ev.tsMs - this.lastScrollTs) : 33
            this.lastScrollTs = ev.tsMs
            window.glance.send('gesture', { type: 'scroll', velocity: this.invertScroll ? -ev.velocity : ev.velocity, dtMs: dt })
            break
          }
        }
      }
    }
  }

  /** Camera-free: synthetic face frames. While a calibration dot is up the frames look at that dot, else a slow loop. */
  startSim(): void {
    if (this.running) return
    this.running = true
    this.setStatus({ state: 'tracking', fps: 30, message: undefined })
    let n = 0
    const t0 = performance.now()
    setInterval(() => {
      const now = performance.now()
      const w = window as unknown as { __glanceTarget?: { x: number; y: number } | null }
      const tt = (now - t0) / 1000
      const target = w.__glanceTarget ?? { x: 0.5 + 0.3 * Math.cos(tt / 2.1), y: 0.5 + 0.25 * Math.sin(tt / 1.7) }
      const f = simulateGaze([target], { msPerPoint: 60, saccadeMs: 1, seed: ++n, noise: 1 }).frames[0]
      if (!f) return
      const frame = { ...f, tsMs: now }
      this.frames.push(now)
      while (this.frames.length && now - this.frames[0]! > 1000) this.frames.shift()
      for (const l of this.listeners) l(frame, null)
      if (this.driving) this.drive(frame, now)
    }, 33)
  }

  stop(): void {
    this.running = false
    this.stream?.getTracks().forEach((t) => t.stop())
    this.lm?.close()
  }
}

export const engine = new Engine()

/** Camera-free check that the local wasm + model load through glance-asset:// and detect() runs. */
export async function selfTest(): Promise<{ ok: boolean; ms: number; faces: number; delegate?: string; error?: string }> {
  const t0 = performance.now()
  try {
    for (let i = 0; i < 90; i++) {
      const a = await window.glance.invoke('assets:ready')
      if (a.ready) break
      if (a.error) throw new Error(a.error)
      await new Promise((r) => setTimeout(r, 1000))
    }
    const lm = await createFaceLandmarker({ wasmRoot: WASM_ROOT, modelUrl: MODEL_URL })
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 480
    const g = c.getContext('2d')!
    g.fillStyle = '#777'
    g.fillRect(0, 0, 640, 480)
    const res = lm.detect(c as unknown as HTMLVideoElement, performance.now())
    lm.close()
    return { ok: true, ms: Math.round(performance.now() - t0), faces: res.faceLandmarks?.length ?? 0 }
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), faces: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
