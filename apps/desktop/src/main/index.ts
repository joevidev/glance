import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, ipcMain, screen, session, shell, systemPreferences, webContents, type Tray } from 'electron'
import { resolveModel, resolveProvider } from '@glance/brain'
import { loadEnv } from './env'
import { InputHelper } from './input'
import { assetState, ensureModel, handleScheme, registerScheme } from './assets'
import { Browse } from './browse'
import { Controller } from './controller'
import { createMainWindow, createOverlayWindow } from './windows'
import { clearCalibration, loadCalibration, loadSettings, saveCalibration, saveSettings } from './store'
import { transcribe } from './speech'
import { createTray } from './tray'
import type { AppInfo, EventMap, GazeMsg, GestureMsg, EngineStatus, IntentResult, InvokeMap, Settings } from '../shared/ipc'

// A tracker window behind other windows must keep running (macOS occlusion would freeze rAF and the camera loop).
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
registerScheme()

const FAKE = (process.env.GLANCE_FAKE_GAZE ?? '').toLowerCase() === 'mouse'
const SHOT = process.env.GLANCE_SCREENSHOT === '1'
const SIM = process.env.GLANCE_SIM_CAMERA === '1'
// test runs never touch the real calibration or settings
if (SHOT || SIM) app.setPath('userData', join(tmpdir(), 'glance-test-userdata'))

let mainWin: BrowserWindow | null = null
let overlayWin: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let settings: Settings
let lastIntent: IntentResult | null = null
let engine: EngineStatus = { state: 'idle', fps: 0 }
const trusted = new Set<number>()
const input = new InputHelper()
let controller: Controller
let browse: Browse

function broadcast<K extends keyof EventMap>(ch: K, msg: EventMap[K]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, msg)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function appInfo(): AppInfo {
  const d = screen.getPrimaryDisplay()
  return {
    fakeGaze: FAKE,
    platform: process.platform,
    hasFireworksKey: !!process.env.FIREWORKS_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    model: resolveModel(resolveProvider()),
    provider: resolveProvider(),
    display: { x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height, scale: d.scaleFactor },
    screenshot: SHOT,
    simCamera: SIM,
  }
}

function applySettings(patch: Partial<Settings>): Settings {
  settings = { ...settings, ...patch }
  saveSettings(settings)
  browse.setDebug(settings.debug)
  controller.setSettings(settings)
  broadcast('settings:changed', settings)
  return settings
}

function showWindow(w: 'main' | 'browse'): void {
  if (w === 'browse') {
    browse.open()
    return
  }
  if (!mainWin || mainWin.isDestroyed()) mainWin = makeMain()
  mainWin.show()
  mainWin.focus()
}

function makeMain(): BrowserWindow {
  const w = createMainWindow()
  trusted.add(w.webContents.id)
  w.on('close', (e) => {
    // closing the control window must not stop the tracker: hide it
    if (!quitting && !SHOT) {
      e.preventDefault()
      w.hide()
    }
  })
  return w
}

async function runIntent(command: string, source: 'typed' | 'voice', gazeScreen: { x: number; y: number } | null): Promise<IntentResult> {
  if (!browse.isFrontAndVisible()) browse.open()
  const r = await browse.decide({ command, source, gazeScreen, settings })
  lastIntent = r
  broadcast('intent:result', r)
  if (r.error && !r.element) {
    controller.toast(r.error.length > 90 ? r.error.slice(0, 90) + '…' : r.error, 'Glance could not decide')
    return r
  }
  const el = r.element
  if (!el) {
    controller.toast('No element matched', `"${command}"`)
    return r
  }
  const rect = browse.toScreen(el.box)
  if (!rect) return r
  controller.showRing({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, name: el.name, role: el.role }, 3200)
  controller.toast(`${el.role} “${el.name.slice(0, 46)}”`, `${r.latencyMs} ms · ${r.pickMode === 'nearest' ? 'nearest to gaze' : 'model pick'}`, 3000)
  controller.holdCursor(2200)
  // make sure the page is really on top before the real click lands on it
  app.focus({ steal: true })
  browse.win?.show()
  browse.win?.moveTop()
  browse.win?.focus()
  await sleep(550) // let the ring read before the click
  await input.moveAwait(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await sleep(120)
  await input.click('left')
  return r
}

let pttStopAt = 0
async function handleVoice(audio: ArrayBuffer, mime: string): Promise<{ text: string; error?: string }> {
  const gaze = controller.gazeAround(pttStopAt || Date.now())
  const t = await transcribe(audio, mime)
  if (t.error || !t.text) {
    controller.toast(t.error ? 'Speech failed' : 'Did not catch that', t.error?.slice(0, 90) ?? 'Try again or type the command')
    return t
  }
  controller.toast(`“${t.text}”`, 'Heard', 1800)
  void runIntent(t.text, 'voice', gaze)
  return t
}

function registerIpc(): void {
  const h = <K extends keyof InvokeMap>(ch: K, fn: (arg: InvokeMap[K][0], e: Electron.IpcMainInvokeEvent) => InvokeMap[K][1] | Promise<InvokeMap[K][1]>) =>
    ipcMain.handle(ch, (e, arg) => fn(arg as InvokeMap[K][0], e))

  h('app:info', () => appInfo())
  h('input:status', () => input.status())
  h('input:requestAccess', () => systemPreferences.isTrustedAccessibilityClient(true))
  h('calib:load', () => loadCalibration())
  h('calib:save', (j) => saveCalibration(j))
  h('calib:clear', () => clearCalibration())
  h('calib:fullscreen', (on) => {
    if (!mainWin) return
    if (on) {
      mainWin.setSimpleFullScreen(true)
      mainWin.setAlwaysOnTop(true, 'screen-saver')
    } else {
      mainWin.setAlwaysOnTop(false)
      mainWin.setSimpleFullScreen(false)
    }
  })
  h('settings:get', () => settings)
  h('settings:set', (p) => applySettings(p))
  h('browse:open', (u) => browse.open(u))
  h('browse:navigate', (u) => browse.navigate(u))
  h('browse:state', () => browse.state())
  h('browse:back', () => browse.back())
  h('browse:reload', () => browse.reload())
  h('intent:run', (a) => runIntent(a.command, a.source, controller.gaze))
  h('intent:last', () => lastIntent)
  h('speech:transcribe', (a) => handleVoice(a.audio, a.mime))
  h('assets:ready', () => assetState())
  h('win:show', (w) => showWindow(w))
  h('perm:media', async ({ kind }) => {
    if (SHOT || SIM) return 'granted'
    try {
      const cur = systemPreferences.getMediaAccessStatus(kind)
      if (cur === 'granted') return 'granted'
      if (cur === 'not-determined') return (await systemPreferences.askForMediaAccess(kind)) ? 'granted' : 'denied'
      return cur
    } catch (e) {
      return 'error: ' + (e instanceof Error ? e.message : String(e))
    }
  })
  h('perm:openSettings', (pane) => {
    void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`)
  })

  ipcMain.on('gaze:frame', (_e, m: GazeMsg) => controller.onGazeFrame(m))
  ipcMain.on('gesture', (_e, g: GestureMsg) => void controller.onGesture(g))
  ipcMain.on('engine:status', (_e, s: EngineStatus) => {
    engine = s
  })
  ipcMain.on('ptt:state', (_e, s: { recording: boolean }) => {
    if (!s.recording) pttStopAt = Date.now()
    controller.recording = s.recording
    controller.push(true)
  })
}

function toggleRecording(): void {
  if (!mainWin || mainWin.isDestroyed()) return
  mainWin.webContents.send('ptt:toggle')
}

function togglePause(): boolean {
  applySettings({ paused: !settings.paused })
  controller.toast(settings.paused ? 'Tracking paused' : 'Tracking resumed', 'Alt+Shift+P', 1600)
  return settings.paused
}

app.whenReady().then(async () => {
  loadEnv()
  handleScheme()
  void ensureModel()
  settings = loadSettings()
  if (FAKE || SIM) settings = { ...settings, cursorControl: false }

  // camera and microphone are only for our own windows, never for the page being browsed
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media' && !!wc && trusted.has(wc.id))
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' && !!wc && trusted.has(wc.id))

  input.onStatus = (s) => broadcast('input:status', s)
  input.start()

  controller = new Controller(input, settings, FAKE)
  controller.onPtt = toggleRecording
  browse = new Browse({ onResult: () => {} })
  browse.debug = settings.debug
  registerIpc()

  mainWin = makeMain()
  overlayWin = createOverlayWindow()
  trusted.add(overlayWin.webContents.id)
  controller.onOverlay = (s) => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('overlay:state', s)
  }
  controller.start()

  app.on('browser-window-created', (_e, w) => {
    if (w !== mainWin && w !== overlayWin) trusted.add(w.webContents.id)
  })
  screen.on('display-metrics-changed', () => {
    controller.refreshDisplay()
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setBounds(screen.getPrimaryDisplay().bounds)
  })

  globalShortcut.register('Alt+Space', toggleRecording)
  globalShortcut.register('Alt+Shift+P', () => void togglePause())

  tray = createTray({ show: showWindow, togglePause, isPaused: () => settings.paused, quit: () => app.quit() })

  if (SHOT && process.env.GLANCE_SIMFLOW === '1') {
    const { runSimFlow } = await import('./simflow')
    void runSimFlow({ main: () => mainWin, overlay: () => overlayWin, controller, outDir: join(app.getAppPath(), '.screens'), userData: app.getPath('userData') })
  } else if (SHOT) {
    const { runScreenshots } = await import('./screenshot')
    void runScreenshots({
      main: () => mainWin,
      overlay: () => overlayWin,
      browse,
      controller,
      runIntent,
      applySettings,
      input,
      showMain: () => showWindow('main'),
      outDir: join(app.getAppPath(), '.screens'),
    })
  }
})

app.on('before-quit', () => {
  quitting = true
  globalShortcut.unregisterAll()
  controller?.stop()
  input.stop()
})
app.on('activate', () => showWindow('main'))
app.on('window-all-closed', () => {
  /* tray app: keep running */
})
void tray
void engine
void mkdirSync
void writeFileSync
void webContents
