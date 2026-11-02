// The control loop in the main process: gaze -> cursor, gestures -> real input, radial menu, overlay state.
// Gaze NEVER clicks by itself: a click needs a wink (or a radial item chosen by dwell + the user's deliberate look).
import { screen } from 'electron'
import { DwellDetector } from '@glance/gaze'
import type { InputHelper } from './input'
import type { GazeMsg, GestureMsg, OverlayState, Settings } from '../shared/ipc'

const RADIAL_ITEMS = [
  { id: 'click', label: 'Click' },
  { id: 'right', label: 'Right click' },
  { id: 'drag', label: 'Drag' },
  { id: 'scroll_up', label: 'Scroll up' },
  { id: 'scroll_down', label: 'Scroll down' },
  { id: 'mic', label: 'Mic' },
]
const RADIAL_R = 150 // distance of item centers from the radial center
const RADIAL_HIT = 64 // item hit radius
const RADIAL_DWELL_MS = 900
const RADIAL_OPEN_DWELL_MS = 1000

type Pt = { x: number; y: number }

export class Controller {
  settings: Settings
  fake: boolean
  private display = screen.getPrimaryDisplay().bounds
  /** Latest gaze in global screen points. */
  gaze: Pt | null = null
  private hist: { ts: number; p: Pt }[] = []
  private dwell = 0
  private prevDwell = 0
  private holdUntil = 0
  private ring: OverlayState['ring'] = null
  private ringUntil = 0
  private toastObj: OverlayState['toast'] = null
  private toastUntil = 0
  private toastId = 0
  private radial: { cx: number; cy: number; hover: number | null; since: number; openedAt: number } | null = null
  private dragging = false
  recording = false
  private fakeDwell = new DwellDetector({ radiusPx: 70, dwellMs: RADIAL_OPEN_DWELL_MS })
  private lastSend = 0
  private fakeTimer: NodeJS.Timeout | null = null
  private lastClickAt = 0
  onOverlay: (s: OverlayState) => void = () => {}
  onPtt: () => void = () => {}

  constructor(private input: InputHelper, settings: Settings, fake: boolean) {
    this.settings = settings
    this.fake = fake
  }

  refreshDisplay(): void {
    this.display = screen.getPrimaryDisplay().bounds
  }

  start(): void {
    if (this.fake) {
      this.fakeTimer = setInterval(() => {
        const p = screen.getCursorScreenPoint()
        const now = Date.now()
        const d = this.fakeDwell.update(p, now)
        this.ingest(p, d.progress, false, now)
      }, 16)
    }
    setInterval(() => this.push(true), 120) // keeps timed overlays (toast, ring) expiring even with no gaze frames
  }

  setSettings(s: Settings): void {
    this.settings = s
    if (s.paused) this.closeRadial()
    this.push(true)
  }

  toast(text: string, sub?: string, ms = 2600): void {
    this.toastObj = { id: ++this.toastId, text, sub }
    this.toastUntil = Date.now() + ms
    this.push(true)
  }

  showRing(ring: NonNullable<OverlayState['ring']>, ms = 2600): void {
    this.ring = ring
    this.ringUntil = Date.now() + ms
    this.push(true)
  }

  /** Where the gaze was just before `ts` (mean over the previous windowMs): for voice commands, which arrive late. */
  gazeAround(ts: number, windowMs = 700): Pt | null {
    const pts = this.hist.filter((h) => h.ts <= ts && h.ts >= ts - windowMs)
    if (pts.length === 0) return this.gaze
    const n = pts.length
    return { x: pts.reduce((a, h) => a + h.p.x, 0) / n, y: pts.reduce((a, h) => a + h.p.y, 0) / n }
  }

  holdCursor(ms: number): void {
    this.holdUntil = Date.now() + ms
  }

  /** Real gaze frames from the tracker in the main window's renderer. */
  onGazeFrame(m: GazeMsg): void {
    if (this.fake) return
    if (m.nx === null || m.ny === null) {
      this.gaze = null
      this.dwell = 0
      this.push()
      return
    }
    const p = { x: this.display.x + m.nx * this.display.width, y: this.display.y + m.ny * this.display.height }
    this.ingest(p, m.dwell, m.held, m.ts)
  }

  private ingest(p: Pt, dwell: number, held: boolean, ts: number): void {
    const now = Date.now()
    this.gaze = p
    this.hist.push({ ts: now, p })
    while (this.hist.length && now - this.hist[0]!.ts > 4000) this.hist.shift()
    this.dwell = dwell
    if (this.settings.paused) {
      this.push()
      return
    }
    // cursor follows the gaze (not in fake mode: there the real mouse IS the gaze)
    if (!this.fake && this.settings.cursorControl && !held && now > this.holdUntil && !this.radial) {
      this.input.move(p.x, p.y)
    }
    // dwell opens the radial menu, never a click
    const fired = dwell >= 1 && this.prevDwell < 1
    this.prevDwell = dwell
    if (fired && !this.radial && !this.dragging) this.openRadial(p)
    if (this.radial) this.updateRadial(p, now)
    void ts
    this.push()
  }

  // ---------- radial menu ----------
  private openRadial(p: Pt): void {
    const m = RADIAL_R + RADIAL_HIT + 12
    const d = this.display
    const cx = Math.min(Math.max(p.x, d.x + m), d.x + d.width - m)
    const cy = Math.min(Math.max(p.y, d.y + m), d.y + d.height - m)
    this.radial = { cx, cy, hover: null, since: Date.now(), openedAt: Date.now() }
  }
  closeRadial(): void {
    this.radial = null
    this.push(true)
  }
  private itemCenter(i: number, cx: number, cy: number): Pt {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / RADIAL_ITEMS.length
    return { x: cx + RADIAL_R * Math.cos(a), y: cy + RADIAL_R * Math.sin(a) }
  }
  private updateRadial(p: Pt, now: number): void {
    const r = this.radial!
    if (now - r.openedAt > 9000) return this.closeRadial()
    if (Math.hypot(p.x - r.cx, p.y - r.cy) > RADIAL_R + 230) return this.closeRadial()
    let hover: number | null = null
    let best = RADIAL_HIT * 1.25
    RADIAL_ITEMS.forEach((_, i) => {
      const c = this.itemCenter(i, r.cx, r.cy)
      const d = Math.hypot(p.x - c.x, p.y - c.y)
      if (d < best) {
        best = d
        hover = i
      }
    })
    if (hover !== r.hover) {
      r.hover = hover
      r.since = now
    }
    if (hover !== null && now - r.since >= RADIAL_DWELL_MS && now - r.openedAt > 600) void this.commitRadial()
  }
  private async commitRadial(): Promise<void> {
    const r = this.radial
    if (!r || r.hover === null) return
    const id = RADIAL_ITEMS[r.hover]!.id
    const at = { x: r.cx, y: r.cy }
    this.radial = null
    this.dwell = 0
    this.fakeDwell.reset()
    this.push(true)
    this.holdCursor(1500)
    switch (id) {
      case 'click':
        await this.input.moveAwait(at.x, at.y)
        await this.input.click('left')
        this.toast('Click')
        break
      case 'right':
        await this.input.moveAwait(at.x, at.y)
        await this.input.click('right')
        this.toast('Right click')
        break
      case 'drag':
        await this.input.moveAwait(at.x, at.y)
        await this.input.down('left')
        this.dragging = true
        this.toast('Dragging', 'Close your mouth or wink to drop')
        break
      case 'scroll_up':
        await this.input.moveAwait(at.x, at.y)
        await this.input.scroll(600)
        break
      case 'scroll_down':
        await this.input.moveAwait(at.x, at.y)
        await this.input.scroll(-600)
        break
      case 'mic':
        this.onPtt()
        break
    }
  }

  // ---------- gestures ----------
  async onGesture(g: GestureMsg): Promise<void> {
    if (this.settings.paused) return
    const now = Date.now()
    switch (g.type) {
      case 'wink_left': {
        if (this.dragging) return void this.drop()
        if (this.radial?.hover != null) return void this.commitRadial()
        await this.clickAtGaze('left', false, false)
        this.lastClickAt = now
        break
      }
      case 'wink_right':
        if (this.radial) return this.closeRadial()
        await this.clickAtGaze('right', false, false)
        break
      case 'double_wink_left':
        // the first wink already clicked once: add only the second pair so it is exactly one double click
        await this.input.click('left', false, true)
        this.toast('Double click')
        break
      case 'double_wink_right':
        await this.input.click('right')
        break
      case 'mouth_open_start':
        if (!this.dragging) {
          await this.input.down('left')
          this.dragging = true
          this.toast('Drag', 'Move your gaze, close your mouth to drop')
        }
        break
      case 'mouth_open_end':
        if (this.dragging) await this.drop()
        break
      case 'scroll': {
        if (this.radial) return
        const dy = Math.round((-g.velocity * Math.min(g.dtMs, 80)) / 1000)
        if (dy !== 0) void this.input.scroll(dy)
        break
      }
      case 'brows_up':
        break
    }
  }

  private async drop(): Promise<void> {
    this.dragging = false
    await this.input.up('left')
    this.toast('Dropped')
  }

  private async clickAtGaze(button: 'left' | 'right', double: boolean, second: boolean): Promise<void> {
    // the point from just before the eyelid started closing
    const p = this.gazeAround(Date.now() - 250, 300) ?? this.gaze
    this.holdCursor(700)
    if (p && !this.fake) await this.input.moveAwait(p.x, p.y)
    await this.input.click(button, double, second)
    if (p) this.showRing({ x: p.x - 28, y: p.y - 28, w: 56, h: 56, name: button === 'left' ? 'click' : 'right click', role: '' }, 600)
  }

  // ---------- overlay ----------
  private lastKey = ''
  push(force = false): void {
    const now = Date.now()
    if (this.ring && now > this.ringUntil) this.ring = null
    if (this.toastObj && now > this.toastUntil) this.toastObj = null
    if (!force && now - this.lastSend < 16) return
    this.lastSend = now
    const d = this.display
    const g = this.gaze && !this.settings.paused ? { x: this.gaze.x - d.x, y: this.gaze.y - d.y } : null
    const rad = this.radial
    const state: OverlayState = {
      gaze: g,
      dwell: this.radial ? 0 : this.dwell,
      ring: this.ring ? { ...this.ring, x: this.ring.x - d.x, y: this.ring.y - d.y } : null,
      toast: this.toastObj,
      radial: rad
        ? {
            cx: rad.cx - d.x,
            cy: rad.cy - d.y,
            hover: rad.hover,
            progress: rad.hover === null ? 0 : Math.min(1, (now - rad.since) / RADIAL_DWELL_MS),
            items: RADIAL_ITEMS.map((i) => ({ id: i.id, label: i.id === 'mic' && this.recording ? 'Stop' : i.label })),
          }
        : null,
      recording: this.recording,
      paused: this.settings.paused,
      fake: this.fake,
      dragging: this.dragging,
    }
    const key = JSON.stringify(state)
    if (!force && key === this.lastKey) return
    this.lastKey = key
    this.onOverlay(state)
  }

  stop(): void {
    if (this.fakeTimer) clearInterval(this.fakeTimer)
  }
}
