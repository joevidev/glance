// Typing mode: "type with your eyes". A non-activating glass panel at the bottom of the screen (the app being typed into keeps
// focus), three reply suggestions + a gaze keyboard, text injected by the native helper (CGEvent unicode keyboard events).
import { tmpdir } from 'node:os'
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import type { Browse } from '../../browse'
import type { Controller } from '../../controller'
import type { InputHelper } from '../../input'
import { loadRoute } from '../../windows'
import { join } from 'node:path'
import type { ChatClient } from '@glance/brain'
import type { GestureMsg } from '../../../shared/ipc'
import type { EventMap } from '../../../shared/ipc'
import type { PredictResult, SuggestResult, TypingMode, TypingSource, TypingStatsMsg } from '../../../shared/typing'
import { browseContext, desktopContext } from './context'
import { fastClient, fastModel } from './model'
import { predictWords } from './predict'
import { suggestReplies } from './suggest'
import { TypingStats } from './stats'

const HEIGHT: Record<TypingMode, number> = { replies: 330, keys: 560 }

export interface TypingDeps {
  input: InputHelper
  controller: Controller
  browse: Browse
  broadcast: <K extends keyof EventMap>(ch: K, msg: EventMap[K]) => void
  /** Tests inject a mocked client. */
  client?: () => ChatClient
}

export class Typing {
  win: BrowserWindow | null = null
  isOpen = false
  mode: TypingMode = 'replies'
  readonly stats = new TypingStats()
  /** E2E only: pretend the gaze is here (screen points). */
  gazeOverride: { x: number; y: number } | null = null
  private timer: NodeJS.Timeout | null = null
  private loaded = false
  private lastSuggest: SuggestResult | null = null

  constructor(private d: TypingDeps) {}

  private client(): ChatClient {
    return this.d.client ? this.d.client() : fastClient()
  }

  private bounds(): Electron.Rectangle {
    const disp = screen.getPrimaryDisplay().bounds
    const h = HEIGHT[this.mode]
    const w = Math.min(1240, disp.width - 48)
    return { x: disp.x + Math.round((disp.width - w) / 2), y: disp.y + disp.height - h - 14, width: w, height: h }
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      ...this.bounds(),
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false, // never steals focus: keystrokes keep going to the app being typed into
      skipTaskbar: true,
      fullscreenable: false,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.webContents.once('did-finish-load', () => {
      this.loaded = true
    })
    loadRoute(win, 'typing')
    this.win = win
    this.loaded = false
    return win
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  open(): void {
    if (this.isOpen) return
    const win = this.ensureWindow()
    this.isOpen = true
    this.mode = 'replies'
    win.setBounds(this.bounds())
    win.showInactive()
    this.stats.reset()
    this.d.controller.radialSuspended = true
    this.d.controller.closeRadial()
    this.d.controller.gestureHook = (g) => this.onGesture(g)
    this.timer = setInterval(() => this.pumpGaze(), 33)
    this.pushStats()
    if (this.loaded) this.d.broadcast('typing:opened', undefined as never)
    else win.webContents.once('did-finish-load', () => this.d.broadcast('typing:opened', undefined as never))
    this.d.controller.toast('Typing', 'Look at a reply or a key. Hold 1 s or wink', 2200)
  }

  close(): void {
    if (!this.isOpen) return
    this.isOpen = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.win?.hide()
    this.d.controller.radialSuspended = false
    this.d.controller.gestureHook = null
  }

  private onGesture(g: GestureMsg): boolean {
    if (!this.isOpen) return false
    if (g.type === 'wink_left') {
      this.d.broadcast('typing:wink', undefined as never)
      return true
    }
    // a right wink or other clicks must not click through the panel by accident
    return g.type === 'wink_right' || g.type === 'double_wink_left' || g.type === 'double_wink_right'
  }

  private pumpGaze(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const g = this.gazeOverride ?? this.d.controller.gaze
    const b = win.getBounds()
    const local = g ? { x: Math.round(g.x - b.x), y: Math.round(g.y - b.y) } : null
    // sent on every tick (also when unchanged): the renderer's dwell treats a gaze that stops arriving as "looked away"
    win.webContents.send('typing:gaze', local)
  }

  setMode(mode: TypingMode): void {
    this.mode = mode
    if (this.win && !this.win.isDestroyed()) this.win.setBounds(this.bounds())
  }

  pushStats(): TypingStatsMsg {
    const s = this.stats.snapshot()
    this.d.broadcast('typing:stats', s)
    return s
  }

  async suggest(): Promise<SuggestResult> {
    const gaze = this.gazeOverride ?? this.d.controller.gaze
    const browseFocused = !!this.d.browse.win && !this.d.browse.win.isDestroyed() && this.d.browse.win.isFocused()
    const ctx = (browseFocused ? await browseContext(this.d.browse, gaze) : null) ?? (await desktopContext(this.d.input))
    const r = await suggestReplies(ctx, { client: this.client(), model: fastModel() })
    this.lastSuggest = r
    this.stats.lastSuggestMs = r.latencyMs
    this.stats.suggestModel = r.source === 'model' ? r.model : `${r.model} (offline fallback)`
    this.pushStats()
    return r
  }

  last(): SuggestResult | null {
    return this.lastSuggest
  }

  predict(text: string): Promise<PredictResult> {
    return predictWords(text, { client: this.client(), model: fastModel() })
  }

  async type(text: string, source: TypingSource): Promise<{ ok: boolean; error?: string }> {
    if (!text) return { ok: true }
    const r = await this.d.input.op({ op: 'type', text }, 8000)
    if (!r.ok) return { ok: false, error: r.error }
    this.stats.record(source, [...text].length)
    this.pushStats()
    return { ok: true }
  }

  async key(key: string, modifiers: string[] = [], source: TypingSource = 'key'): Promise<{ ok: boolean; error?: string }> {
    const r = await this.d.input.op({ op: 'key', key, modifiers }, 3000)
    if (!r.ok) return { ok: false, error: r.error }
    const bs = key === 'delete' && modifiers.length === 0
    this.stats.record(source, bs ? 0 : key === 'return' || key === 'space' ? 1 : 0, bs ? -1 : key === 'return' || key === 'space' ? 1 : 0)
    this.pushStats()
    return { ok: true }
  }

  reset(): void {
    this.stats.reset()
    this.pushStats()
  }
}

// the automated end-to-end run never touches the real calibration/settings (must be set before app ready)
export const TYPING_E2E = process.env.GLANCE_TYPING_E2E === '1'
if (TYPING_E2E) app.setPath('userData', join(tmpdir(), `glance-typing-e2e-${process.pid}`))

/** Entry point: index.ts only calls registerTyping(). Opens with the radial "Type" item, the tray-less shortcut Alt+Shift+T, or the Browse debug panel. */
export function registerTyping(deps: { browse: Browse; controller: Controller; input: InputHelper; outDir: string }): Typing {
  const broadcast: TypingDeps['broadcast'] = (ch, msg) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, msg)
  }
  const typing = new Typing({ ...deps, broadcast })
  ipcMain.handle('typing:open', () => typing.open())
  ipcMain.handle('typing:close', () => typing.close())
  ipcMain.handle('typing:suggest', () => typing.suggest())
  ipcMain.handle('typing:predict', (_e, a: { text: string }) => typing.predict(String(a.text ?? '')))
  ipcMain.handle('typing:type', (_e, a: { text: string; source: TypingSource }) => typing.type(String(a.text ?? ''), a.source))
  ipcMain.handle('typing:key', (_e, a: { key: string; modifiers?: string[]; source?: TypingSource }) => typing.key(a.key, a.modifiers ?? [], a.source))
  ipcMain.handle('typing:stats', () => typing.stats.snapshot())
  ipcMain.handle('typing:reset', () => typing.reset())
  ipcMain.handle('typing:mode', (_e, a: { mode: TypingMode }) => typing.setMode(a.mode))
  deps.controller.onType = () => typing.toggle()
  globalShortcut.register('Alt+Shift+T', () => typing.toggle())
  if (TYPING_E2E) void import('./e2e').then((m) => m.runTypingE2E({ ...deps, typing }))
  return typing
}
