import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { is } from './is'

const preload = () => join(__dirname, '../preload/index.mjs')

export function loadRoute(win: BrowserWindow, route: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/${route}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: `/${route}` })
  }
}

const webPrefs = () => ({
  preload: preload(),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false, // ESM preload; contextIsolation stays on
  backgroundThrottling: false, // the tracker must keep running behind other windows
})

export function createMainWindow(): BrowserWindow {
  const d = screen.getPrimaryDisplay()
  const w = 1040
  const h = 700
  const win = new BrowserWindow({
    x: d.bounds.x + Math.round((d.bounds.width - w) / 2),
    y: d.bounds.y + Math.round((d.bounds.height - h) / 2),
    width: w,
    height: h,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    title: 'Glance',
    webPreferences: webPrefs(),
  })
  win.once('ready-to-show', () => win.show())
  loadRoute(win, 'main')
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  return win
}

/** Transparent, frameless, always-on-top, click-through layer over the whole primary display. */
export function createOverlayWindow(): BrowserWindow {
  const d = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: webPrefs(),
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setBounds(d.bounds)
  win.once('ready-to-show', () => win.showInactive())
  loadRoute(win, 'overlay')
  return win
}

export function createBrowseChrome(): BrowserWindow {
  const d = screen.getPrimaryDisplay()
  const w = Math.min(1360, d.workArea.width - 120)
  const h = Math.min(880, d.workArea.height - 80)
  const win = new BrowserWindow({
    x: d.workArea.x + Math.round((d.workArea.width - w) / 2) + 40,
    y: d.workArea.y + 30,
    width: w,
    height: h,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    title: 'Glance Browse',
    acceptFirstMouse: true,
    webPreferences: webPrefs(),
  })
  loadRoute(win, 'browse')
  return win
}
