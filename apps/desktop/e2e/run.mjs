#!/usr/bin/env node
// Glance e2e: launches the REAL Electron app and drives it. Usage:
//   node apps/desktop/e2e/run.mjs            all scenarios
//   node apps/desktop/e2e/run.mjs s2 s3      only those
//   E2E_NO_BUILD=1 ...                       reuse e2e/.app/out
// Screenshots: apps/desktop/e2e/out/<scenario>/NN-label-<window>.png ; summary: out/summary.json
// Uses the REAL mouse (native helper) and a few live OpenAI calls (about 5 per full run).
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Glance, Mouse, Report, OUT, build, sleep, dirSnapshot, realUserData, writeFakeInputUntrusted } from './lib.mjs'

const only = process.argv.slice(2)
const scenarios = []
const scenario = (id, title, fn, opts = {}) => scenarios.push({ id, title, fn, opts })

const openBrowse = async (g) => {
  await g.main.evaluate(() => window.glance.invoke('browse:open'))
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try {
      if ((await g.page('document.readyState + "|" + !!document.getElementById("log")')) === 'complete|true') break
    } catch {
      /* not yet */
    }
    await sleep(200)
  }
  await g.waitWindow('#/browse')
  await sleep(600)
}
const send = (g, m) => g.main.evaluate((msg) => window.glance.send('gesture', msg), m) // real path: renderer -> ipcMain 'gesture' -> controller
// gestures that click need the page's window to be active; other agents' Electron apps steal focus, so re-assert it right before
let gesture = async (g, m) => {
  if (/^(wink|double)/.test(m.type) || m.type === 'mouth_open_start') {
    await front(g)
    await sleep(120)
  }
  return send(g, m)
}
const instrument = (g) =>
  g.page(`(() => { window.__ev = { click: 0, dbl: 0, ctx: 0, down: [], up: [], move: 0 };
    const o = { capture: true };
    document.addEventListener('click', () => window.__ev.click++, o);
    document.addEventListener('dblclick', () => window.__ev.dbl++, o);
    document.addEventListener('contextmenu', () => window.__ev.ctx++, o);
    document.addEventListener('mousedown', (e) => window.__ev.down.push([Math.round(e.clientX), Math.round(e.clientY), e.buttons]), o);
    document.addEventListener('mouseup', (e) => window.__ev.up.push([Math.round(e.clientX), Math.round(e.clientY), e.button]), o);
    document.addEventListener('mousemove', (e) => { if (e.buttons) window.__ev.move++ }, o);
    return true })()`)
const evs = (g) => g.page('JSON.parse(JSON.stringify(window.__ev))')
const waitFor = async (fn, ms = 8000, step = 100) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn()
      if (v) return { v, ms: Date.now() - t0 }
    } catch {
      /* retry */
    }
    await sleep(step)
  }
  return { v: null, ms: Date.now() - t0 }
}
/** The Browse window must be the active app for synthetic clicks to land (other apps/agents may steal focus). */
const front = async (g, ms = 6000) => {
  const t0 = Date.now()
  for (;;) {
    const ok = await g.ev(({ app, BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('#/browse'))
      if (w?.isFocused()) return true
      app.focus({ steal: true })
      w?.show()
      w?.moveTop()
      w?.focus()
      return false
    })
    if (ok) return Date.now() - t0
    if (Date.now() - t0 > ms) return -1
    await sleep(120)
  }
}
const radialOpen = async (g) => /Scroll down/.test(await g.win('overlay', 'document.body.innerText'))
/** In fake-gaze mode a still mouse opens the radial at launch; move away until it is closed so each test starts clean. */
const settleRadial = async (g, mouse) => {
  const d = (await g.main.evaluate(() => window.glance.invoke('app:info'))).display
  // never the screen corners: macOS hot corners would fire
  for (const [x, y] of [[d.x + 40, d.y + d.h / 2], [d.x + d.w - 40, d.y + d.h / 2], [d.x + d.w / 2, d.y + d.h - 60]]) {
    await mouse.move(x, y)
    await sleep(400)
    if (!(await radialOpen(g))) break
  }
  await front(g)
  if (!(await radialOpen(g))) return true
  const c = await waitFor(async () => !(await radialOpen(g)), 10000, 200)
  return !!c.v
}
const clickBtn = (page, text) => page.locator('button', { hasText: text }).first().click({ timeout: 20000 })

// ============================================================================ S1 onboarding
scenario('s1', 'Onboarding with the simulated camera', async (g, r) => {
  const real0 = dirSnapshot(realUserData())
  await sleep(2500)
  await g.shot('welcome')
  const w = await g.text('main')
  r.check('welcome shows camera + accessibility + key rows', /Camera/.test(w) && /Accessibility/.test(w) && /OpenAI key/.test(w))
  r.check('welcome shows provider/model', /openai · gpt-6-astra/.test(w))
  await clickBtn(g.main, 'Calibrate my eyes')
  const cam = await waitFor(async () => (await g.main.locator('button:has-text("Start calibration"):not([disabled])').count()) > 0, 30000, 300)
  r.check('camera step: face found, Start enabled', cam.v, cam.ms + ' ms')
  await sleep(800)
  await g.shot('camera')
  await clickBtn(g.main, 'Start calibration')
  await sleep(5000)
  await g.shot('calibrating')
  const fit = await waitFor(async () => /leave-one-out/i.test(await g.text('main')), 90000, 500)
  r.check('9-point calibration completes and shows the fit', fit.v, Math.round(fit.ms / 1000) + ' s')
  const txt = await g.text('main')
  const loo = Number((txt.match(/(\d+)\s*PX ERROR/i) ?? [])[1])
  r.num('looErrorPx(synthetic)', loo)
  r.check('leave-one-out error is a finite number', Number.isFinite(loo), loo + ' px (synthetic frames)')
  await sleep(600)
  await g.shot('fit')
  await clickBtn(g.main, 'Validate my eyes')
  const val = await waitFor(async () => (await g.main.locator('button:has-text("Continue to gestures")').count()) > 0, 90000, 500)
  r.check('validation on 6 unseen points completes', val.v, Math.round(val.ms / 1000) + ' s')
  await sleep(600)
  const vt = (await g.text('main')).replace(/\s+/g, ' ')
  r.num('validation text', vt.slice(0, 160))
  await g.shot('validation')
  await clickBtn(g.main, 'Continue to gestures')
  await sleep(1200)
  await g.shot('gestures-start')
  for (let i = 0; i < 10; i++) {
    if ((await g.main.locator('button:has-text("Finish setup")').count()) > 0) break
    await clickBtn(g.main, i === 0 ? 'Start' : 'Ready')
    await waitFor(async () => (await g.main.locator('button:has-text("Ready"):not([disabled]), button:has-text("Finish setup")').count()) > 0, 15000, 250)
  }
  await sleep(500)
  const gt = await g.text('main')
  await g.shot('gestures-result')
  const works = (gt.match(/Clear signal/g) ?? []).length
  const bad = (gt.match(/Not reliable/g) ?? []).length
  r.num('gestures works/not', `${works}/${bad}`)
  r.check('gesture training reaches the result screen', /Finish setup/.test(gt), `works ${works}, not reliable ${bad}`)
  await clickBtn(g.main, 'Finish setup')
  await sleep(1500)
  await g.shot('look-and-wink-intro')
  await clickBtn(g.main, 'Skip')
  const dash = await waitFor(async () => /Gaze error/i.test(await g.text('main')), 10000, 300)
  r.check('dashboard shown', dash.v)
  await sleep(2500)
  await g.shot('dashboard')
  const dt = await g.text('main')
  r.check('dashboard: tracker running with fps', /\d+ FPS/i.test(dt), (dt.match(/\d+ FPS/i) ?? [''])[0])
  const f = join(g.userData, 'calibration', 'gaze.calib.json')
  r.check('calibration saved in the temp userData dir', existsSync(f), existsSync(f) ? statSync(f).size + ' bytes at ' + g.userData : 'missing')
  r.check('real userData untouched', dirSnapshot(realUserData()) === real0)
}, { env: { GLANCE_FAKE_GAZE: undefined } })

// ============================================================================ S2 browse intent
scenario('s2', 'Browse: "open that" with the gaze on a link, ring + tag, click lands, debug panel, ablation', async (g, r, mouse) => {
  await openBrowse(g)
  await sleep(500)
  const chrome = await g.waitWindow('#/browse')
  const link = await g.elScreen('a[data-m="Invoice 4821"]')
  r.check('found the Invoice link on the page', !!link, link ? `screen ${Math.round(link.x)},${Math.round(link.y)}` : '')
  await g.page('document.getElementById("log").textContent="Click log: (reset)"; true')
  await front(g)
  await mouse.move(link.x + 40, link.y + 8)
  await sleep(250)
  const t0 = Date.now()
  const p = g.main.evaluate(() => window.glance.invoke('intent:run', { command: 'open that', source: 'typed' }))
  const ring = await waitFor(async () => /Invoice/.test(await g.win('overlay', 'document.body.innerText')), 15000, 80)
  const tRing = Date.now() - t0
  if (ring.v) await g.shot('ring-and-tag')
  const res = await p
  r.check('ring + name tag appear on the model pick', ring.v, `after ${tRing} ms; tag text contains Invoice`)
  r.num('intent latency ms', res.latencyMs)
  r.check('model picked the Invoice link', /Invoice/.test(res.element?.name ?? ''), `${res.provider} ${res.model} -> [${res.modelPick}] "${res.element?.name}"; nearest [${res.nearestPick}]`)
  const landed = await waitFor(async () => /Invoice 4821/.test(await g.page('document.getElementById("log").textContent')), 6000, 100)
  const log = await g.page('document.getElementById("log").textContent')
  r.check('the real click lands in the page', landed.v, log + ' | title: ' + (await g.page('document.title')))
  await sleep(300)
  await g.shot('after-click')
  const ct = await g.win('browse', 'document.body.innerText')
  r.check('debug panel: provider · model', /openai · gpt-6-astra/.test(ct))
  r.check('debug panel: latency in ms', /\d+ ms/.test(ct), (ct.match(/\d+ ms/) ?? [''])[0])
  r.check('debug panel: model pick, nearest pick, raw reply', /model pick/i.test(ct) && /nearest to gaze/i.test(ct) && /raw reply/i.test(ct))

  // ablation: gaze on "Weekly update", command names the invoice
  const weekly = await g.elScreen('a[data-m="Weekly update"]')
  const run = async (mode) => {
    await chrome.locator('button', { hasText: mode === 'model' ? 'Model pick' : 'Nearest to gaze' }).first().click()
    await sleep(300)
    await g.page('document.getElementById("log").textContent="Click log: (reset)"; true')
    await front(g)
    await mouse.move(weekly.x, weekly.y)
    await sleep(250)
    const rr = await g.main.evaluate(() => window.glance.invoke('intent:run', { command: 'open the invoice', source: 'typed' }))
    await waitFor(async () => !/\(reset\)/.test(await g.page('document.getElementById("log").textContent')), 6000, 100)
    return { rr, log: await g.page('document.getElementById("log").textContent') }
  }
  const nearest = await run('nearest')
  await g.shot('ablation-nearest')
  const model = await run('model')
  await g.shot('ablation-model')
  r.check('ablation: "Nearest to gaze" clicks the gaze-nearest link', /Weekly update/.test(nearest.log), `${nearest.log}; modelPick "${nearest.rr.modelElement?.name}"`)
  r.check('ablation: "Model pick" clicks the invoice instead', /Invoice 4821/.test(model.log), `${model.log}; ${model.rr.latencyMs} ms`)
  r.num('ablation latencies ms', `${nearest.rr.latencyMs}/${model.rr.latencyMs}`)
}, { env: { GLANCE_ELEMENTS: 'dom' } })

// ============================================================================ S3 gestures drive the real cursor
const s3body = async (g, r, mouse) => {
  await openBrowse(g)
  await instrument(g)
  await settleRadial(g, mouse)
  const a = await g.elScreen('a[data-m="Weekly update"]')
  const b = await g.elScreen('a[data-m="Photos"]')
  const at = async (p) => {
    await front(g)
    await mouse.move(p.x, p.y)
    await sleep(200)
  }
  // single left click
  await at(a)
  await gesture(g, { type: 'wink_left' })
  const c1 = await waitFor(async () => (await evs(g)).click >= 1, 3000, 50)
  r.check('wink_left -> exactly one click', c1.v && (await evs(g)).click === 1, `${(await evs(g)).click} click, ${c1.ms} ms`)
  await g.shot('wink-left')
  // double wink = first wink then the double event
  await at(b)
  const before = await evs(g)
  await gesture(g, { type: 'wink_left' })
  await sleep(250)
  await gesture(g, { type: 'double_wink_left' })
  await sleep(700)
  const after = await evs(g)
  r.check('double wink -> exactly ONE dblclick (2 clicks total)', after.dbl - before.dbl === 1 && after.click - before.click === 2, `dblclick +${after.dbl - before.dbl}, click +${after.click - before.click}`)
  // right click, 5 times, fresh position each time (no dwell)
  let ok = 0
  const ms = []
  for (let i = 0; i < 5; i++) {
    await at(i % 2 ? a : b)
    const c0 = (await evs(g)).ctx
    const t0 = Date.now()
    await gesture(g, { type: 'wink_right' })
    const w = await waitFor(async () => (await evs(g)).ctx > c0, 1500, 30)
    if (w.v && (await evs(g)).ctx === c0 + 1) ok++
    ms.push(w.ms)
  }
  r.check('wink_right -> exactly one contextmenu, 5 of 5 (no dwell)', ok === 5, `${ok}/5, ms ${ms.join(',')}`)
  await g.shot('wink-right')
  // right click after the user dwelled on the target >1 s (radial menu is open by then): the flaky case
  let okDwell = 0
  for (let i = 0; i < 3; i++) {
    await at(i % 2 ? a : b)
    await sleep(1400)
    const radialOpen = /Right click/.test(await g.win('overlay', 'document.body.innerText'))
    if (i === 0) await g.shot('wink-right-after-dwell')
    const c0 = (await evs(g)).ctx
    await gesture(g, { type: 'wink_right' })
    const w = await waitFor(async () => (await evs(g)).ctx > c0, 1200, 30)
    if (w.v) okDwell++
    r.num('dwell wink_right #' + i, `radial open=${radialOpen}, contextmenu=${!!w.v}`)
    if (!w.v) r.num('events after failed dwell wink #' + i, JSON.stringify(await evs(g)).slice(0, 200) + ' focus=' + (await g.ev(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((x) => x.isFocused()))))
  }
  r.check('wink_right after a 1.4 s dwell still right-clicks, 3 of 3', okDwell === 3, `${okDwell}/3`)
  // wink_left after a dwell
  await at(a)
  await sleep(1400)
  const cb = (await evs(g)).click
  await gesture(g, { type: 'wink_left' })
  const wl = await waitFor(async () => (await evs(g)).click > cb, 1500, 30)
  r.check('wink_left after a 1.4 s dwell still clicks', wl.v, wl.ms + ' ms')
  // scroll
  await at(b)
  await sleep(100)
  await gesture(g, { type: 'brows_up' })
  const y0 = await g.page('window.scrollY')
  for (let i = 0; i < 8; i++) {
    await gesture(g, { type: 'scroll', velocity: 800, dtMs: 33 })
    await sleep(33)
  }
  await sleep(600)
  const y1 = await g.page('window.scrollY')
  r.check('brows + nod down scrolls the page down', y1 > y0, `scrollY ${y0} -> ${y1}`)
  await g.shot('scrolled')
  for (let i = 0; i < 8; i++) {
    await gesture(g, { type: 'scroll', velocity: -800, dtMs: 33 })
    await sleep(33)
  }
  await sleep(600)
  const y2 = await g.page('window.scrollY')
  r.check('nod up scrolls back up', y2 < y1, `scrollY ${y1} -> ${y2}`)
  // drag: mouth open = press, move, close = release (on plain text: a link would start a native HTML5 drag-and-drop that swallows mouseup)
  await at(await g.elScreen('h1'))
  const d0 = await evs(g)
  await gesture(g, { type: 'mouth_open_start' })
  await waitFor(async () => (await evs(g)).down.length > d0.down.length, 2000, 30)
  await mouse.move(b.x, b.y)
  await sleep(300)
  await g.shot('dragging')
  await gesture(g, { type: 'mouth_open_end' })
  await waitFor(async () => (await evs(g)).up.length > d0.up.length, 2000, 30)
  const d1 = await evs(g)
  const dn = d1.down[d1.down.length - 1]
  const up = d1.up[d1.up.length - 1]
  r.check('mouth open presses (buttons=1), mouth close releases', d1.down.length === d0.down.length + 1 && d1.up.length === d0.up.length + 1 && dn?.[2] === 1, `down ${JSON.stringify(dn)} up ${JSON.stringify(up)} (drag MOTION is covered in s3b: a second helper process cannot move a button held by the app's helper)`)
}
scenario('s3', 'Gestures drive the real cursor (click, double, right click x5, scroll, drag)', s3body)
scenario('s3n', 'Same as s3 WITHOUT the simulated camera (GLANCE_FAKE_GAZE=mouse only)', s3body, { env: { GLANCE_SIM_CAMERA: undefined } })

// ============================================================================ S3b gaze drives the real cursor + drag motion
scenario('s3b', 'Gaze frames drive the real cursor (display mapping) and a mouth-open drag moves', async (g, r, mouse) => {
  const info = await g.main.evaluate(() => window.glance.invoke('app:info'))
  const d = info.display
  await g.main.evaluate(() => window.glance.invoke('settings:set', { cursorControl: true }))
  await openBrowse(g)
  await instrument(g)
  await front(g)
  const geo = await g.browseGeom()
  const frame = (x, y, extra = {}) => g.main.evaluate((m) => window.glance.send('gaze:frame', m), { ts: Date.now(), nx: (x - d.x) / d.w, ny: (y - d.y) / d.h, speed: 0, dwell: 0, held: false, ...extra })
  const stream = async (x0, y0, x1, y1, ms) => {
    const t0 = Date.now()
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / ms)
      await frame(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)
      if (k >= 1) break
      await sleep(25)
    }
  }
  const h1 = await g.elScreen('h1')
  const lg = await g.elScreen('#log')
  const A = { x: h1.x, y: h1.y } // plain text: a link would start a native drag-and-drop that swallows mouseup
  const B = { x: lg.x, y: lg.y }
  await stream(A.x, A.y, A.x, A.y, 500)
  await sleep(150)
  const p = await mouse.pos()
  const err = Math.hypot(p.x - A.x, p.y - A.y)
  r.check('gaze frame moves the real cursor to the mapped screen point', err < 4, `target ${Math.round(A.x)},${Math.round(A.y)} cursor ${Math.round(p.x)},${Math.round(p.y)} err ${err.toFixed(1)} px`)
  await sleep(1500) // hold still a while: engine/sim frames must not fight ours
  const p2 = await mouse.pos()
  r.check('cursor is stable while the gaze is still (no competing frames)', Math.hypot(p2.x - A.x, p2.y - A.y) < 4, `drift ${Math.hypot(p2.x - A.x, p2.y - A.y).toFixed(1)} px`)
  // the dwell opened the radial? the frames carry dwell:0, so it must NOT
  r.check('no radial without dwell progress in the frames', !(await radialOpen(g)))
  const d0 = await evs(g)
  await gesture(g, { type: 'mouth_open_start' })
  await waitFor(async () => (await evs(g)).down.length > d0.down.length, 2000, 30)
  await stream(A.x, A.y, B.x, B.y, 700)
  await sleep(150)
  await g.shot('dragging')
  await gesture(g, { type: 'mouth_open_end' })
  await waitFor(async () => (await evs(g)).up.length > d0.up.length, 2000, 30)
  const d1 = await evs(g)
  const dn = d1.down[d1.down.length - 1]
  const up = d1.up[d1.up.length - 1]
  r.check('drag: press at A, motion with button held, release at B', d1.down.length === d0.down.length + 1 && d1.move > 5 && up && dn && Math.hypot(up[0] - dn[0], up[1] - dn[1]) > 250, `down ${JSON.stringify(dn)} up ${JSON.stringify(up)} drag-moves ${d1.move}`)
  // click at the gaze point
  await stream(B.x, B.y, A.x, A.y, 300)
  await sleep(500)
  const c0 = (await evs(g)).click
  await gesture(g, { type: 'wink_left' })
  const c = await waitFor(async () => (await evs(g)).click > c0, 2000, 30)
  r.check('wink_left clicks at the gaze point', c.v, c.ms + ' ms')
  // gaze lost: no crash, cursor stays
  await g.main.evaluate(() => window.glance.send('gaze:frame', { ts: Date.now(), nx: null, ny: null, speed: 0, dwell: 0, held: false }))
  await sleep(300)
  r.check('app survives a lost-face frame', !(await g.main.isClosed()))
}, { env: { GLANCE_FAKE_GAZE: undefined } })

// ============================================================================ S4 radial
scenario('s4', 'Radial menu after a 1 s dwell, choose Scroll down by looking 1 s', async (g, r, mouse) => {
  await openBrowse(g)
  await instrument(g)
  await settleRadial(g, mouse)
  const geo = await g.browseGeom()
  const cx = geo.pageScreen.x + geo.pageScreen.w / 2
  const cy = geo.pageScreen.y + geo.pageScreen.h / 2
  await mouse.move(cx + 300, cy + 200) // away, so the dwell timer restarts
  await sleep(300)
  await mouse.move(cx, cy)
  const t0 = Date.now()
  const open = await waitFor(async () => /Scroll down/.test(await g.win('overlay', 'document.body.innerText')), 4000, 40)
  r.check('radial opens after about 1 s of dwell', open.v && open.ms > 800 && open.ms < 1800, `${open.ms} ms`)
  await sleep(300)
  await g.shot('radial-open')
  const txt = await g.win('overlay', 'document.body.innerText')
  r.check('radial shows all 6 items', ['Click', 'Right click', 'Drag', 'Scroll up', 'Scroll down', 'Mic'].every((l) => txt.includes(l)))
  // item positions come from the overlay DOM (layout-agnostic: other agents add items)
  const items = await g.win('overlay', `[...document.querySelectorAll('span')].filter((s) => s.className.includes('text-[13px]') && s.className.includes('font-medium') && s.closest('.glass')).map((s) => { const r = s.closest('.glass').getBoundingClientRect(); return { label: s.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 } })`)
  const it = items.find((i) => i.label === 'Scroll down')
  r.check('radial items read from the overlay DOM', items.length >= 6 && !!it, items.map((i) => i.label).join(' | '))
  const d0 = (await g.main.evaluate(() => window.glance.invoke('app:info'))).display
  const ix = d0.x + it.x
  const iy = d0.y + it.y
  const y0 = await g.page('window.scrollY')
  await mouse.move(ix, iy)
  const t1 = Date.now()
  await sleep(500)
  await g.shot('radial-hover')
  const gone = await waitFor(async () => !/Scroll down/.test(await g.win('overlay', 'document.body.innerText')), 4000, 50)
  await sleep(400)
  const y1 = await g.page('window.scrollY')
  r.check('looking at "Scroll down" for ~1 s commits it', gone.v && y1 > y0, `commit after ${Date.now() - t1 - 400} ms, scrollY ${y0} -> ${y1}`)
  const c = (await evs(g)).click
  r.check('dwell alone never clicks', c === 0, `${c} clicks`)
  await g.shot('radial-done')
})

// ============================================================================ S5 pause shortcut
scenario('s5', 'Pause shortcut Alt+Shift+P', async (g, r, mouse) => {
  await openBrowse(g)
  await instrument(g)
  const a = await g.elScreen('a[data-m="Weekly update"]')
  await mouse.move(a.x, a.y)
  const key = () => spawnSync('osascript', ['-e', 'tell application "System Events" to key code 35 using {option down, shift down}'], { encoding: 'utf8' })
  const k1 = key()
  r.check('keystroke sent via System Events', k1.status === 0, (k1.stderr || '').slice(0, 120))
  const p1 = await waitFor(async () => (await g.main.evaluate(() => window.glance.invoke('settings:get'))).paused === true, 3000, 100)
  r.check('Alt+Shift+P pauses tracking', p1.v, p1.ms + ' ms')
  await sleep(500)
  await g.shot('paused')
  r.check('overlay says Paused', /paused/i.test(await g.win('overlay', 'document.body.innerText')))
  await gesture(g, { type: 'wink_left' })
  await sleep(700)
  r.check('wink is ignored while paused', (await evs(g)).click === 0, (await evs(g)).click + ' clicks')
  key()
  const p2 = await waitFor(async () => (await g.main.evaluate(() => window.glance.invoke('settings:get'))).paused === false, 3000, 100)
  r.check('Alt+Shift+P resumes', p2.v, p2.ms + ' ms')
  await mouse.move(a.x + 120, a.y)
  await sleep(200)
  await gesture(g, { type: 'wink_left' })
  const c = await waitFor(async () => (await evs(g)).click === 1, 2000, 50)
  r.check('wink works again after resume', c.v, JSON.stringify(await evs(g)).slice(0, 160) + ' focus=' + (await g.ev(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((x) => x.isFocused()))))
})

// ============================================================================ S6 missing key
scenario('s6', 'Startup with a missing OPENAI key: clear message, no crash', async (g, r, mouse) => {
  await sleep(2000)
  const w = await g.text('main')
  await g.shot('welcome-no-key')
  r.check('welcome shows the key as missing', /OPENAI_API_KEY|OpenAI key/.test(w) && /missing|not set|Add|\.env/i.test(w), w.split('\n').filter((l) => /key|OPENAI/i.test(l)).join(' / ').slice(0, 200))
  await openBrowse(g)
  const link = await g.elScreen('a[data-m="Invoice 4821"]')
  await mouse.move(link.x, link.y)
  const res = await g.main.evaluate(() => window.glance.invoke('intent:run', { command: 'open that', source: 'typed' }))
  await sleep(900)
  await g.shot('error')
  r.check('intent returns a clear error naming the key', /OPENAI_API_KEY/.test(res.error ?? ''), res.error ?? '(no error)')
  const ct = await g.win('browse', 'document.body.innerText')
  r.check('debug panel shows the error', /OPENAI_API_KEY/.test(ct))
  r.check('overlay toast explains it', /could not decide/i.test(await g.win('overlay', 'document.body.innerText')))
  r.check('app is still alive', g.app.windows().length >= 3 && !(await g.main.isClosed()))
})

// ============================================================================ S7 accessibility missing
scenario('s7', 'Accessibility permission missing: clear message', async (g, r) => {
  await sleep(2500)
  const st = await g.main.evaluate(() => window.glance.invoke('input:status'))
  r.check('input status reports trusted:false with a message', st.trusted === false && /Accessibility/.test(st.error ?? ''), JSON.stringify(st).slice(0, 180))
  const w = await g.text('main')
  await g.shot('welcome-no-ax')
  r.check('welcome shows the Accessibility row as not allowed, with an Allow button', /Needed to move the real cursor and click/.test(w) && /Allow/.test(w))
  await openBrowse(g)
  await gesture(g, { type: 'wink_left' })
  await sleep(900)
  await g.shot('click-without-ax')
  const o = await g.win('overlay', 'document.body.innerText')
  r.check('a wink without permission tells the user why instead of failing silently', /Accessibility/i.test(o), o.replace(/\s+/g, ' ').slice(0, 120))
}, { env: { GLANCE_INPUT_BIN: 'FAKE_UNTRUSTED' } })

// ============================================================================ runner
const keyless = { OPENAI_API_KEY: '' }
const extraEnv = { s6: keyless }
async function main() {
  mkdirSync(OUT, { recursive: true })
  if (!process.env.E2E_NO_BUILD) build()
  const fakeBin = writeFakeInputUntrusted()
  const table = []
  for (const s of scenarios) {
    if (only.length && !only.includes(s.id)) continue
    console.log(`\n=== ${s.id}: ${s.title}`)
    const r = new Report(s.id)
    const env = { ...(s.opts.env ?? {}), ...(extraEnv[s.id] ?? {}) }
    if (env.GLANCE_INPUT_BIN === 'FAKE_UNTRUSTED') env.GLANCE_INPUT_BIN = fakeBin
    let g
    const mouse = new Mouse()
    await mouse.release()
    const t0 = Date.now()
    try {
      g = await Glance.launch({ name: s.id, env })
      await s.fn(g, r, mouse)
    } catch (e) {
      r.check('scenario ran to the end', false, String(e?.message ?? e).split('\n')[0].slice(0, 220))
      try {
        if (g) await g.shot('failure')
      } catch {
        /* ignore */
      }
    } finally {
      await mouse.release()
      mouse.close()
      if (g) {
        writeFileSync(join(OUT, s.id, 'app.log'), g.log.replace(/(sk-[A-Za-z0-9_-]{8,})/g, '[redacted]'))
        await g.close()
      }
    }
    const secs = Math.round((Date.now() - t0) / 1000)
    console.log(`  => ${r.pass ? 'PASS' : 'FAIL'} ${s.id} (${secs} s) ${JSON.stringify(r.nums)}`)
    table.push({ id: s.id, title: s.title, pass: r.pass, secs, nums: r.nums, checks: r.checks })
    await sleep(800)
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), table }, null, 2))
  console.log('\n==== SUMMARY')
  for (const t of table) console.log(`${t.pass ? 'PASS' : 'FAIL'}  ${t.id}  ${t.title}  (${t.checks.filter((c) => c.ok).length}/${t.checks.length} checks)`)
  process.exit(table.every((t) => t.pass) ? 0 : 1)
}
main()
