// e2e harness for the real Glance Electron app. No dependencies added: Playwright's _electron comes from a
// playwright-core already on this machine (override with PW_CORE=/path/to/playwright-core).
// The app is built into e2e/.app/out so a parallel `electron-vite build` by another agent cannot clobber a run.
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const E2E = dirname(fileURLToPath(import.meta.url))
export const DESKTOP = resolve(E2E, '..')
export const ROOT = resolve(DESKTOP, '../..')
export const OUT = join(E2E, 'out')
export const APP = join(E2E, '.app')
export const INPUT_BIN = join(ROOT, 'packages/input/target/release/glance-input')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const require = createRequire(import.meta.url)
function loadPlaywright() {
  const cands = [process.env.PW_CORE, join(homedir(), '.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core'), join(homedir(), '.npm/_npx/58725bd0998f572c/node_modules/playwright-core'), 'playwright-core', 'playwright'].filter(Boolean)
  for (const c of cands) {
    try {
      return require(c)
    } catch {
      /* next */
    }
  }
  throw new Error('playwright-core not found; set PW_CORE=/path/to/playwright-core')
}
export const pw = loadPlaywright()

/** Build main+preload+renderer into e2e/.app/out (private to the harness). */
export function build() {
  mkdirSync(APP, { recursive: true })
  const bin = join(DESKTOP, 'node_modules/.bin/electron-vite')
  let last = ''
  for (let i = 0; i < 8; i++) {
    const r = spawnSync(bin, ['build', '--outDir', join(APP, 'out')], { cwd: DESKTOP, encoding: 'utf8' })
    last = (r.stdout ?? '') + (r.stderr ?? '')
    if (r.status === 0) return
    spawnSync('sleep', ['8']) // another agent may be mid-edit
  }
  throw new Error('build failed:\n' + last.slice(-1500))
}

export const electronBin = () => require(join(DESKTOP, 'node_modules/electron'))

// ------------------------------------------------------------------ native mouse (a second helper process of ours)
export class Mouse {
  constructor() {
    this.p = spawn(INPUT_BIN, [], { stdio: ['pipe', 'pipe', 'ignore'] })
    this.buf = ''
    this.id = 1
    this.w = new Map()
    this.p.stdout.on('data', (d) => {
      this.buf += d
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i)
        this.buf = this.buf.slice(i + 1)
        try {
          const r = JSON.parse(line)
          this.w.get(r.id)?.(r)
          this.w.delete(r.id)
        } catch {
          /* ignore */
        }
      }
    })
  }
  op(o) {
    const id = this.id++
    return new Promise((res) => {
      this.w.set(id, res)
      this.p.stdin.write(JSON.stringify({ ...o, id }) + '\n')
      setTimeout(() => this.w.has(id) && (this.w.delete(id), res({ ok: false, error: 'timeout' })), 2000)
    })
  }
  move(x, y) {
    return this.op({ op: 'move', x, y })
  }
  pos() {
    return this.op({ op: 'pos' })
  }
  /** Release any button a killed run may have left pressed (a stuck button makes every later click flaky). */
  async release() {
    await this.op({ op: 'up', button: 'left' })
    await this.op({ op: 'up', button: 'right' })
  }
  close() {
    try {
      this.p.stdin.end()
      this.p.kill()
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------ a running app
export class Glance {
  static async launch({ name, env = {}, args = [] }) {
    mkdirSync(join(OUT, name), { recursive: true })
    const userData = mkdtempSync(join(tmpdir(), 'glance-e2e-'))
    const full = {
      ...process.env,
      GLANCE_PROVIDER: 'openai',
      GLANCE_FAKE_GAZE: 'mouse',
      GLANCE_SIM_CAMERA: '1',
      GLANCE_USERDATA: userData,
      ...env,
    }
    for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k]
    const app = await pw._electron.launch({ executablePath: electronBin(), args: [APP, ...args], env: full, timeout: 60000 })
    const g = new Glance(app, name, userData)
    app.process().stdout?.on('data', (d) => (g.log += d))
    app.process().stderr?.on('data', (d) => (g.log += d))
    // the main window (route #/main)
    g.main = await g.waitWindow('#/main')
    await g.main.waitForLoadState('domcontentloaded')
    return g
  }
  constructor(app, name, userData) {
    this.app = app
    this.name = name
    this.userData = userData
    this.log = ''
    this.n = 0
  }
  async waitWindow(hash, ms = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const w = this.app.windows().find((p) => p.url().includes(hash))
      if (w) return w
      await sleep(150)
    }
    throw new Error('window not found: ' + hash)
  }
  /** Evaluate in the Electron main process; fn receives the electron module. */
  ev(fn, arg) {
    return this.app.evaluate(fn, arg)
  }
  /** Evaluate JS in the page shown by the Browse WebContentsView. */
  page(code) {
    return this.app.evaluate(async ({ webContents }, c) => {
      const wc = webContents.getAllWebContents().find((w) => /^file:.*\.html/.test(w.getURL()) && !/\/out\/renderer\//.test(w.getURL()))
      if (!wc) throw new Error('browse page not found')
      return wc.executeJavaScript(c, true)
    }, code)
  }
  /** Evaluate JS in one of our windows by hash route (main | browse | overlay). */
  win(route, code) {
    return this.app.evaluate(async ({ webContents }, a) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('#/' + a.route))
      if (!wc) throw new Error('window not found: ' + a.route)
      return wc.executeJavaScript(a.code, true)
    }, { route, code })
  }
  async text(route) {
    return this.win(route, 'document.body.innerText')
  }
  /** Rectangle of the page area and Browse window in screen points. */
  async browseGeom() {
    return this.ev(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Glance Browse' || x.webContents.getURL().includes('#/browse'))
      if (!w) return null
      const c = w.getContentBounds()
      const v = w.contentView.children[0]?.getBounds()
      return { win: w.getBounds(), content: c, view: v, pageScreen: v ? { x: c.x + v.x, y: c.y + v.y, w: v.width, h: v.height } : null }
    })
  }
  /** Screen point (center) of the first page element matching a CSS selector. */
  async elScreen(sel) {
    const g = await this.browseGeom()
    const r = await this.page(`(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height} })()`)
    if (!g?.pageScreen || !r) return null
    return { x: g.pageScreen.x + r.x + r.w / 2, y: g.pageScreen.y + r.y + r.h / 2, w: r.w, h: r.h }
  }
  /** Screenshot every window of the app (capturePage; macOS screen-recording permission is not needed). */
  async shot(label) {
    const dir = join(OUT, this.name)
    const idx = String(++this.n).padStart(2, '0')
    const shots = await this.ev(async ({ BrowserWindow, webContents }) => {
      const out = []
      const seen = new Set()
      const take = async (wc, nm) => {
        if (!wc || wc.isDestroyed() || seen.has(wc.id)) return
        seen.add(wc.id)
        try {
          const img = await wc.capturePage()
          if (img.isEmpty()) return
          out.push({ nm, b64: img.toPNG().toString('base64') })
        } catch {
          /* ignore */
        }
      }
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isVisible()) continue
        const u = w.webContents.getURL()
        const nm = u.includes('#/overlay') ? 'overlay' : u.includes('#/browse') ? 'browse' : u.includes('#/main') ? 'main' : 'win' + w.id
        await take(w.webContents, nm)
      }
      for (const wc of webContents.getAllWebContents()) {
        if (/^file:.*\.html/.test(wc.getURL()) && !wc.getURL().includes('/out/renderer/')) await take(wc, 'page')
      }
      return out
    })
    const files = []
    for (const s of shots) {
      const f = join(dir, `${idx}-${label}-${s.nm}.png`)
      writeFileSync(f, Buffer.from(s.b64, 'base64'))
      files.push(f)
    }
    return files
  }
  async close() {
    try {
      await Promise.race([this.app.close(), sleep(5000)])
    } catch {
      /* ignore */
    }
    try {
      this.app.process().kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------ reporting
export class Report {
  constructor(name) {
    this.name = name
    this.checks = []
    this.nums = {}
  }
  check(label, ok, detail = '') {
    this.checks.push({ label, ok: !!ok, detail })
    console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  [' + detail + ']' : ''}`)
    return !!ok
  }
  num(k, v) {
    this.nums[k] = v
  }
  get pass() {
    return this.checks.length > 0 && this.checks.every((c) => c.ok)
  }
}

export function dirSnapshot(dir) {
  try {
    return readdirSync(dir, { recursive: true }).map((f) => {
      try {
        return f + ':' + statSync(join(dir, String(f))).mtimeMs
      } catch {
        return String(f)
      }
    }).sort().join('|')
  } catch {
    return 'absent'
  }
}
export const realUserData = () => join(homedir(), 'Library/Application Support/@glance')

export function writeFakeInputUntrusted() {
  const f = join(OUT, 'fake-input-untrusted.mjs')
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    f,
    `#!${process.execPath}
import readline from 'node:readline'
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (l) => { let m = {}; try { m = JSON.parse(l) } catch {} ; console.log(JSON.stringify({ ok: true, id: m.id, trusted: false, x: 0, y: 0 })) })
`,
    { mode: 0o755 },
  )
  return f
}
export { existsSync }
