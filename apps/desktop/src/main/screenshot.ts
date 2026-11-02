// GLANCE_SCREENSHOT=1: capture each window to apps/desktop/.screens/*.png, then quit. Lets us look at the UI without a camera.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { Browse } from './browse'
import type { Controller } from './controller'
import type { InputHelper } from './input'
import type { IntentResult, Settings } from '../shared/ipc'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function shot(win: BrowserWindow | null | undefined, file: string): Promise<void> {
  if (!win || win.isDestroyed()) return
  const img = await win.webContents.capturePage()
  writeFileSync(file, img.toPNG())
  console.log('screenshot', file, img.getSize().width + 'x' + img.getSize().height)
}

export async function runScreenshots(o: {
  main: () => BrowserWindow | null
  overlay: () => BrowserWindow | null
  browse: Browse
  controller: Controller
  input: InputHelper
  applySettings: (p: Partial<Settings>) => Settings
  runIntent: (c: string, s: 'typed' | 'voice', g: { x: number; y: number } | null) => Promise<IntentResult>
  showMain: () => void
  outDir: string
}): Promise<void> {
  mkdirSync(o.outDir, { recursive: true })
  const tag = process.env.GLANCE_SCREENSHOT_TAG ?? ''
  await sleep(3500)
  try {
    const st = await o.main()?.webContents.executeJavaScript('window.__glanceSelfTest()', true)
    console.log('SELFTEST', JSON.stringify(st))
  } catch (e) {
    console.log('SELFTEST failed', String(e))
  }
  await shot(o.main(), join(o.outDir, `${tag}main.png`))
  o.browse.open()
  await sleep(2500)
  await shot(o.browse.win, join(o.outDir, `${tag}browse-chrome.png`))
  const page = o.browse.view?.webContents
  if (page) {
    const img = await page.capturePage()
    writeFileSync(join(o.outDir, `${tag}browse-page.png`), img.toPNG())
  }
  // overlay: pretend the model chose the second row
  const ex = await o.browse.extract()
  const el = ex?.elements.find((e) => /Invoice/.test(e.name))
  if (el) {
    const r = o.browse.toScreen(el.box)
    if (r) o.controller.showRing({ x: r.x, y: r.y, w: r.width, h: r.height, name: el.name, role: el.role }, 20000)
  }
  o.controller.toast('link “Invoice #4821 is ready”', '412 ms · model pick', 20000)
  await sleep(1200)
  await shot(o.overlay(), join(o.outDir, `${tag}overlay.png`))
  // END TO END: gaze near the Invoice row (offset toward its neighbour), command "open that", model picks, real click lands
  if (el && page) {
    const r0 = o.browse.toScreen(el.box)!
    const gaze = { x: r0.x + r0.width / 2 + 40, y: r0.y + r0.height / 2 + 24 }
    for (const mode of ['model', 'nearest'] as const) {
      await page.executeJavaScript('document.getElementById("log").textContent="Click log: (reset)"')
      o.applySettings({ pick: mode })
      const r = await o.runIntent('open that', 'typed', gaze)
      await sleep(1500)
      const log = await page.executeJavaScript('document.getElementById("log").textContent')
      console.log('E2E', mode, JSON.stringify({ modelPick: r.modelPick, nearest: r.nearestPick, acted: r.element?.name, ms: r.latencyMs, raw: r.raw, err: r.error, log }))
      if (mode === 'model') await shot(o.browse.win, join(o.outDir, `${tag}browse-after-model.png`))
    }
  }
  // M6: gestures drive the real cursor
  if (el && page) {
    const r0 = o.browse.toScreen(el.box)!
    const cx = r0.x + r0.width / 2
    const cy = r0.y + r0.height / 2
    app.focus({ steal: true })
    o.browse.win?.moveTop()
    o.browse.win?.focus()
    await o.input.moveAwait(cx, cy)
    await sleep(300)
    const logOf = () => page.executeJavaScript('document.getElementById("log").textContent') as Promise<string>
    await page.executeJavaScript('document.getElementById("log").textContent="reset"; window.__n=0; document.addEventListener("dblclick",()=>{window.__dbl=(window.__dbl||0)+1}); document.addEventListener("contextmenu",()=>{window.__ctx=(window.__ctx||0)+1})')
    await o.controller.onGesture({ type: 'wink_left' })
    await sleep(400)
    console.log('M6 wink_left ->', await logOf())
    await o.controller.onGesture({ type: 'double_wink_left' })
    await sleep(400)
    console.log('M6 double_wink_left -> dblclick events', await page.executeJavaScript('window.__dbl||0'), '| log', await logOf())
    await o.controller.onGesture({ type: 'wink_right' })
    await sleep(400)
    console.log('M6 wink_right -> contextmenu events', await page.executeJavaScript('window.__ctx||0'))
    const y0 = (await page.executeJavaScript('window.scrollY')) as number
    for (let i = 0; i < 6; i++) await o.controller.onGesture({ type: 'scroll', velocity: 800, dtMs: 33 })
    await sleep(500)
    console.log('M6 scroll(+velocity=down) -> scrollY', y0, '->', await page.executeJavaScript('window.scrollY'))
  }
  app.exit(0)
}
