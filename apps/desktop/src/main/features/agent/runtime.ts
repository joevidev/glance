// Electron side of the assistant: observe the Browse page, execute actions (native click), the confirm channel.
import { BrowserWindow, app, globalShortcut } from 'electron'
import extractSrc from '@glance/elements/extract.js?raw'
import { nearestElement, resolveProvider } from '@glance/brain'
import type { Browse } from '../../browse'
import type { Controller } from '../../controller'
import type { InputHelper } from '../../input'
import type { AgentAction, AgentState, ConfirmRequest } from '../../../shared/agent'
import type { ElementLite } from '../../../shared/ipc'
import { runTask, type AgentDeps, type Observation, type StartContext } from './loop'
import { askModel, resolveAgentModel } from './model'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PAGE_JS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const nm = (el) => (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].textContent) || el.placeholder || el.name || el.id || '').replace(/\\s+/g, ' ').trim()
  const fields = [...document.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(vis).map((el) => ({ name: nm(el), value: String(el.value || '') }))
  return { url: location.href, title: document.title, text: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').trim().slice(0, 1800), fields }
})()`

const gazeJs = (x: number, y: number) => `(() => {
  let el = document.elementFromPoint(${x}, ${y})
  while (el && el !== document.body && (el.innerText || '').trim().length < 12) el = el.parentElement
  if (!el || el === document.body) return null
  return (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300)
})()`

const typeJs = (x: number, y: number, text: string) => `(() => {
  let el = document.elementFromPoint(${x}, ${y})
  el = el && el.closest('input,textarea,select,[contenteditable="true"]')
  if (!el) return { ok: false, error: 'no text field at that element' }
  el.focus()
  if (el.isContentEditable) { el.textContent = ${JSON.stringify(text)} }
  else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)})
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  const v = el.isContentEditable ? el.textContent : el.value
  return v === ${JSON.stringify(text)} ? { ok: true } : { ok: false, error: 'the field did not accept that value (got ' + JSON.stringify(v) + '); check the expected format' }
})()`

export interface AgentRuntimeDeps {
  browse: Browse
  controller: Controller
  input: InputHelper
}

export class AgentRuntime {
  /** Voice commands drive the assistant (true) or the single-click intent path (false). */
  voiceMode = true
  state: AgentState | null = null
  running = false
  /** Test hook (GLANCE_AGENT_E2E only): called when a confirm card is shown; it decides through the same settle path. */
  e2eOnConfirm: ((req: ConfirmRequest) => void) | null = null
  private pending: { id: number; resolve: (ok: boolean) => void; timer: NodeJS.Timeout } | null = null

  constructor(private d: AgentRuntimeDeps) {}

  private broadcast(s: AgentState): void {
    this.state = s
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('agent:state', s)
  }

  async run(command: string, source: 'typed' | 'voice', gazeScreen: { x: number; y: number } | null): Promise<AgentState> {
    if (this.running) return this.state!
    this.running = true
    const { browse, controller } = this.d
    try {
      if (!browse.isFrontAndVisible()) {
        browse.open()
        await sleep(1500)
      }
      controller.toast(`“${command}”`, 'Assistant working', 2200)
      const provider = resolveProvider()
      const model = resolveAgentModel(provider)
      const deps: AgentDeps = {
        model: { id: model, provider },
        startContext: () => this.startContext(gazeScreen),
        observe: () => this.observe(),
        decide: (i) => askModel(i, { provider, model }),
        execute: (a, el) => this.execute(a, el),
        confirm: (req) => this.confirm(req),
        onState: (s) => {
          this.broadcast(s)
          const last = s.steps[s.steps.length - 1]
          if (last && s.status === 'running' && last.status !== 'error') controller.toast(`${last.action}${last.target ? ` “${last.target.slice(0, 40)}”` : ''}`, `step ${last.n}/${s.maxSteps} · ${last.modelMs} ms`, 1600)
        },
      }
      const final = await runTask(deps, command, source)
      const secs = ((final.endedAt ?? Date.now()) - final.startedAt) / 1000
      controller.toast(final.message.slice(0, 80), `${final.status} · ${final.steps.length} steps · ${secs.toFixed(1)} s`, 4000)
      return final
    } finally {
      this.running = false
    }
  }

  // ---------- observe ----------
  async observe(): Promise<Observation> {
    const wc = this.d.browse.view?.webContents
    if (!wc || wc.isDestroyed()) throw new Error('Open the Browse window first.')
    const ex = await this.d.browse.extract()
    const pg = (await wc.executeJavaScript(PAGE_JS)) as { url: string; title: string; text: string; fields: { name: string; value: string }[] }
    return { ...pg, elements: ex?.elements ?? [], viewport: ex?.viewport ?? { w: 0, h: 0 } }
  }

  private async startContext(gazeScreen: { x: number; y: number } | null): Promise<StartContext> {
    const wc = this.d.browse.view?.webContents
    const obs = await this.observe()
    const g = gazeScreen ? this.d.browse.toViewport(gazeScreen) : null
    let gazeText: string | null = null
    let nearest: string | null = null
    if (g && wc) {
      gazeText = (await wc.executeJavaScript(gazeJs(Math.round(g.x), Math.round(g.y)))) as string | null
      const id = nearestElement(g, obs.elements)
      nearest = obs.elements.find((e) => e.id === id)?.name ?? null
    }
    return { pageText: obs.text.slice(0, 1500), gazeText, nearest }
  }

  // ---------- execute ----------
  private async execute(a: AgentAction, el: ElementLite | null): Promise<{ ok: boolean; error?: string }> {
    const { browse, controller, input } = this.d
    const wc = browse.view?.webContents
    if (!wc || wc.isDestroyed()) return { ok: false, error: 'Browse window is closed' }
    if (a.action === 'scroll') {
      await wc.executeJavaScript(`window.scrollBy({ top: ${a.text === 'up' ? '-' : ''}Math.round(window.innerHeight * 0.7) })`)
      await sleep(250)
      return { ok: true }
    }
    if (a.action === 'key') {
      const keyCode = a.text ?? 'Enter'
      wc.sendInputEvent({ type: 'keyDown', keyCode })
      if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' })
      wc.sendInputEvent({ type: 'keyUp', keyCode })
      await this.settle()
      return { ok: true }
    }
    if (!el) return { ok: false, error: 'no element' }
    const rect = browse.toScreen(el.box)
    if (rect) controller.showRing({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, name: el.name, role: el.role }, 1400)
    const cx = el.box.x + el.box.w / 2
    const cy = el.box.y + el.box.h / 2
    if (a.action === 'type') {
      await sleep(250)
      const r = (await wc.executeJavaScript(typeJs(Math.round(cx), Math.round(cy), a.text ?? ''))) as { ok: boolean; error?: string }
      await sleep(150)
      return r
    }
    // click: the same real path as the intent feature (native helper); focus the page first so the click lands on it
    controller.holdCursor(2500)
    app.focus({ steal: true })
    browse.win?.show()
    browse.win?.moveTop()
    browse.win?.focus()
    await sleep(400) // the ring reads before the click
    if (input.trusted && rect) {
      // other processes may move the real cursor: confirm it is on the target right before the click
      const tx = rect.x + rect.width / 2
      const ty = rect.y + rect.height / 2
      for (let i = 0; i < 4; i++) {
        await input.moveAwait(tx, ty)
        const p = await input.pos()
        if (p && Math.hypot(p.x - tx, p.y - ty) < 4) break
      }
      const r = await input.click('left')
      if (!r.ok) return { ok: false, error: 'native click failed: ' + (r.error ?? '') }
    } else {
      // no Accessibility permission: a synthetic click in the page keeps the loop working (reported as a gap)
      wc.sendInputEvent({ type: 'mouseDown', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 })
    }
    await this.settle()
    return { ok: true }
  }

  private async settle(): Promise<void> {
    const wc = this.d.browse.view?.webContents
    await sleep(300)
    for (let i = 0; i < 30 && wc && !wc.isDestroyed() && wc.isLoading(); i++) await sleep(100)
    await sleep(120)
  }

  // ---------- confirm channel ----------
  confirm(req: ConfirmRequest): Promise<boolean> {
    const { controller } = this.d
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.settleConfirm(req.id, false), 120_000)
      this.pending = { id: req.id, resolve, timer }
      controller.setConfirm(req, (g) => this.settleConfirm(req.id, g === 'confirm'))
      for (const [key, ok] of [['Return', true], ['Enter', true], ['Escape', false]] as const) {
        try {
          globalShortcut.register(key, () => this.settleConfirm(req.id, ok))
        } catch {
          /* already taken */
        }
      }
      this.e2eOnConfirm?.(req)
    })
  }

  /** Resolve the pending confirm. Only a deliberate input calls this with ok=true: wink, Enter, the panel button. */
  settleConfirm(id: number, ok: boolean): boolean {
    const p = this.pending
    if (!p || p.id !== id) return false
    this.pending = null
    clearTimeout(p.timer)
    for (const key of ['Return', 'Enter', 'Escape']) {
      try {
        globalShortcut.unregister(key)
      } catch {
        /* ignore */
      }
    }
    this.d.controller.setConfirm(null)
    p.resolve(ok)
    return true
  }
}
