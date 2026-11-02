// The Browse window: glass chrome (URL, command box, debug panel) + a WebContentsView holding the page.
// Elements come from the shared extractor; the model picks one; we click it with the native helper.
import { join } from 'node:path'
import { BrowserWindow, WebContentsView, type Rectangle } from 'electron'
import extractSrc from '@glance/elements/extract.js?raw'
import { decideIntent, nearestElement, resolveModel, resolveProvider } from '@glance/brain'
import { createBrowseChrome } from './windows'
import { repoRoot } from './env'
import type { ElementLite, IntentResult, Settings } from '../shared/ipc'

export const TOP = 64
export const SIDEBAR = 372

export class Browse {
  win: BrowserWindow | null = null
  view: WebContentsView | null = null
  debug = true

  constructor(private deps: { onResult: (r: IntentResult) => void }) {}

  demoUrl(): string {
    return 'file://' + join(repoRoot(), 'apps/desktop/resources/demo.html')
  }

  open(url?: string): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show()
      this.win.focus()
      if (url) void this.view?.webContents.loadURL(normalizeUrl(url))
      return
    }
    const win = createBrowseChrome()
    this.win = win
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    this.view = view
    view.setBackgroundColor('#ffffff')
    win.contentView.addChildView(view)
    win.once('ready-to-show', () => {
      this.layout()
      win.show()
    })
    win.on('resize', () => this.layout())
    win.on('closed', () => {
      this.win = null
      this.view = null
    })
    const wc = view.webContents
    const pushUrl = () =>
      win.isDestroyed() ||
      win.webContents.send('browse:url', { url: wc.getURL(), title: wc.getTitle(), canBack: wc.navigationHistory.canGoBack() })
    wc.on('did-navigate', pushUrl)
    wc.on('did-navigate-in-page', pushUrl)
    wc.on('page-title-updated', pushUrl)
    wc.on('did-finish-load', pushUrl)
    wc.setWindowOpenHandler(({ url: u }) => {
      void wc.loadURL(u)
      return { action: 'deny' }
    })
    void wc.loadURL(url ? normalizeUrl(url) : this.demoUrl())
    this.layout()
  }

  setDebug(v: boolean): void {
    this.debug = v
    this.layout()
  }

  layout(): void {
    if (!this.win || this.win.isDestroyed() || !this.view) return
    const size = this.win.getContentSize()
    const w = size[0] ?? 1000
    const h = size[1] ?? 700
    const side = this.debug ? SIDEBAR : 0
    this.view.setBounds({ x: 0, y: TOP, width: Math.max(200, w - side), height: Math.max(200, h - TOP) })
  }

  state(): { url: string; title: string; canBack: boolean } {
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) return { url: '', title: '', canBack: false }
    return { url: wc.getURL(), title: wc.getTitle(), canBack: wc.navigationHistory.canGoBack() }
  }

  navigate(u: string): void {
    void this.view?.webContents.loadURL(normalizeUrl(u))
  }
  back(): void {
    const nh = this.view?.webContents.navigationHistory
    if (nh?.canGoBack()) nh.goBack()
  }
  reload(): void {
    this.view?.webContents.reload()
  }

  /** Rectangle of the page area in global screen points (macOS: DIP == CoreGraphics points). */
  pageScreenBounds(): Rectangle | null {
    if (!this.win || this.win.isDestroyed() || !this.view) return null
    const c = this.win.getContentBounds()
    const b = this.view.getBounds()
    return { x: c.x + b.x, y: c.y + b.y, width: b.width, height: b.height }
  }

  isFrontAndVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized()
  }

  async extract(): Promise<{ elements: ElementLite[]; viewport: { w: number; h: number } } | null> {
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) return null
    const viewport = (await wc.executeJavaScript('({w: Math.round(window.innerWidth), h: Math.round(window.innerHeight)})')) as { w: number; h: number }
    const elements = (await wc.executeJavaScript(extractSrc)) as ElementLite[]
    return { elements: Array.isArray(elements) ? elements : [], viewport }
  }

  /** Element box (viewport CSS px) to a rectangle in global screen points. */
  toScreen(box: ElementLite['box']): Rectangle | null {
    const pb = this.pageScreenBounds()
    const wc = this.view?.webContents
    if (!pb || !wc) return null
    const z = wc.getZoomFactor()
    return { x: Math.round(pb.x + box.x * z), y: Math.round(pb.y + box.y * z), width: Math.round(box.w * z), height: Math.round(box.h * z) }
  }

  toViewport(p: { x: number; y: number }): { x: number; y: number } | null {
    const pb = this.pageScreenBounds()
    const wc = this.view?.webContents
    if (!pb || !wc) return null
    const z = wc.getZoomFactor()
    return { x: (p.x - pb.x) / z, y: (p.y - pb.y) / z }
  }

  /** Decide which element the user means. Does NOT click: the caller acts on `actedOn`. */
  async decide(args: {
    command: string
    source: 'typed' | 'voice'
    gazeScreen: { x: number; y: number } | null
    settings: Settings
  }): Promise<IntentResult> {
    const t0 = Date.now()
    const empty: IntentResult = {
      ts: t0,
      command: args.command,
      source: args.source,
      modelPick: null,
      nearestPick: null,
      actedOn: null,
      pickMode: args.settings.pick,
      latencyMs: 0,
      raw: '',
      model: resolveModel(resolveProvider()),
      provider: resolveProvider(),
      elementCount: 0,
      gaze: null,
      viewport: null,
      element: null,
      nearestElement: null,
      modelElement: null,
    }
    let ex: Awaited<ReturnType<Browse['extract']>> = null
    try {
      ex = await this.extract()
    } catch (e) {
      return { ...empty, error: 'could not read the page: ' + (e instanceof Error ? e.message : String(e)) }
    }
    if (!ex) return { ...empty, error: 'Open the Browse window first.' }
    const gaze = args.gazeScreen ? this.toViewport(args.gazeScreen) : null
    const byId = (id: number | null) => (id === null ? null : (ex!.elements.find((e) => e.id === id) ?? null))
    const nearestPick = gaze ? nearestElement(gaze, ex.elements) : null
    const base = { ...empty, elementCount: ex.elements.length, gaze, viewport: ex.viewport, nearestPick, nearestElement: byId(nearestPick) }
    if (ex.elements.length === 0) return { ...base, error: 'No clickable elements found on this page.' }
    const d = await decideIntent(
      { viewport: ex.viewport, gaze, command: args.command, elements: ex.elements },
      { withGaze: args.settings.withGaze && !!gaze },
    )
    const modelEl = byId(d.target)
    const acted = args.settings.pick === 'nearest' ? nearestPick : d.target
    return {
      ...base,
      modelPick: d.target,
      modelElement: modelEl,
      actedOn: byId(acted) ? acted : null,
      latencyMs: d.latencyMs,
      raw: d.raw,
      model: d.model,
      provider: d.provider,
      element: byId(acted),
      error: d.error,
    }
  }
}

function normalizeUrl(u: string): string {
  const s = u.trim()
  if (/^(https?|file):\/\//i.test(s)) return s
  if (/^[\w-]+(\.[\w-]+)+(\/|$|:)/.test(s)) return 'https://' + s
  return 'https://www.google.com/search?q=' + encodeURIComponent(s)
}
