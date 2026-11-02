// GLANCE_AGENT_E2E=1: run both Jarvis scenarios on the offline demo site with the real click path, screenshot, read the
// page state afterwards and print AGENT_E2E lines. The ONLY auto-confirm lives here and it first asserts that nothing was
// sent/saved yet (that assertion is the proof that the loop stopped at the irreversible step).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import { join as pjoin } from 'node:path'
import { repoRoot } from '../../env'
import type { Browse } from '../../browse'
import type { Controller } from '../../controller'
import type { InputHelper } from '../../input'
import type { AgentRuntime } from './runtime'
import type { AgentState } from '../../../shared/agent'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const demo = (f: string) => 'file://' + pjoin(repoRoot(), 'apps/desktop/resources/demo', f)

export async function runAgentE2E(o: Parameters<typeof run>[0]): Promise<void> {
  try {
    await run(o)
  } catch (e) {
    console.log('AGENT_E2E error', e instanceof Error ? e.stack : String(e))
    app.exit(1)
  }
}

async function run(o: { browse: Browse; controller: Controller; input: InputHelper; agent: AgentRuntime; outDir: string }): Promise<void> {
  const { browse, agent } = o
  mkdirSync(o.outDir, { recursive: true })
  const tag = process.env.GLANCE_AGENT_TAG ?? ''
  const only = (process.env.GLANCE_AGENT_ONLY ?? 'AB').toUpperCase()
  await sleep(2500)
  browse.open(demo('index.html'))
  const wc = browse.view!.webContents
  const loaded = async (needle: string) => {
    for (let i = 0; i < 100; i++) {
      if (!wc.isLoading() && wc.getURL().includes(needle)) return
      await sleep(100)
    }
    throw new Error('page did not load: ' + needle)
  }
  await loaded('index.html')
  await sleep(500)
  const js = <T>(s: string) => (wc.executeJavaScript(s) as Promise<T>).catch((e) => { throw new Error(`${String(e)} | script: ${s.slice(0, 90)} | url: ${wc.getURL()}`) })
  const shot = async (name: string) => {
    for (const [wcx, suffix] of [[browse.win?.webContents, 'chrome'], [browse.view?.webContents, 'page']] as const) {
      if (!wcx || wcx.isDestroyed()) continue
      const img = await wcx.capturePage()
      writeFileSync(join(o.outDir, `${tag}agent-${name}-${suffix}.png`), img.toPNG())
    }
  }
  console.log('AGENT_E2E start', JSON.stringify({ trusted: o.input.trusted, model: process.env.GLANCE_AGENT_MODEL ?? 'default', provider: process.env.GLANCE_PROVIDER }))
  console.log('AGENT_E2E url', wc.getURL(), wc.isLoading())
  await js('try { localStorage.clear() } catch (e) { console.log(String(e)) }').catch((e) => console.log('AGENT_E2E clear failed', String(e)))

  // gaze (global screen points) at the center of a DOM rect found by selector
  const gazeAt = async (sel: string, dx = 0, dy = 0) => {
    for (let i = 0; i < 50 && !(await js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => false)); i++) await sleep(100)
    const r = await js<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
    const pb = browse.pageScreenBounds()!
    return { x: pb.x + r.x + r.w / 2 + dx, y: pb.y + r.y + r.h / 2 + dy }
  }

  const runScenario = async (name: string, command: string, gaze: { x: number; y: number }, notYet: string, after: string): Promise<AgentState> => {
    let shotDone = false
    let stoppedBeforeIrreversible: boolean | null = null
    agent.e2eOnConfirm = (req) => {
      void (async () => {
        await sleep(900) // the card is on screen
        stoppedBeforeIrreversible = await js<boolean>(notYet)
        console.log('AGENT_E2E confirm-card', name, JSON.stringify({ title: req.title, actionName: req.actionName, nothingDoneYet: stoppedBeforeIrreversible }))
        if (!shotDone) {
          shotDone = true
          await shot(`${name}-confirm`)
          // the overlay window is transparent: paint a grey ground so the white glass confirm card is visible in the capture
          const ov = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('overlay'))
          if (ov) {
            await ov.webContents.executeJavaScript("document.documentElement.style.setProperty('background', '#3a3a3a', 'important')")
            await sleep(300)
            writeFileSync(join(o.outDir, `${tag}agent-${name}-confirm-overlay.png`), (await ov.webContents.capturePage()).toPNG())
            await ov.webContents.executeJavaScript("document.documentElement.style.removeProperty('background')")
          }
        }
        if (stoppedBeforeIrreversible) agent.settleConfirm(req.id, true)
        else agent.settleConfirm(req.id, false) // something already happened without a confirm: fail the test, do not confirm
      })()
    }
    const t0 = Date.now()
    const st = await agent.run(command, 'typed', gaze)
    const secs = (Date.now() - t0) / 1000
    await sleep(600)
    const pageState = await js<unknown>(after)
    await shot(`${name}-final`)
    console.log(
      'AGENT_E2E result',
      name,
      JSON.stringify({
        command,
        status: st.status,
        message: st.message,
        steps: st.steps.length,
        seconds: Math.round(secs * 10) / 10,
        modelMsTotal: st.steps.reduce((a, s) => a + s.modelMs, 0),
        waitMs: st.steps.reduce((a, s) => a + s.waitMs, 0),
        tokensIn: st.tokensIn,
        tokensOut: st.tokensOut,
        stoppedBeforeIrreversible,
        trace: st.steps.map((s) => `${s.n}:${s.action}${s.target ? ' ' + JSON.stringify(s.target) : ''}${s.text && s.action === 'type' ? ' =' + JSON.stringify(s.text.slice(0, 70)) : ''} ${s.modelMs}ms ${s.status}${s.irreversible ? ' [IRREVERSIBLE]' : ''}`),
        pageState,
      }),
    )
    return st
  }

  const repeat = Number(process.env.GLANCE_AGENT_REPEAT ?? 1)
  for (let rep = 1; rep <= repeat; rep++) {
    await js('localStorage.clear()')
    console.log('AGENT_E2E run', rep)
    if (only.includes('A')) {
      await js('location.href = ' + JSON.stringify(demo('index.html')))
      await sleep(300)
      await loaded('index.html')
      const g = await gazeAt('a.row[data-id="ana"]', 40, 8)
      await runScenario(
        'A',
        'reply yes, tomorrow at 3 works',
        g,
        `!(document.getElementById('sent') && document.getElementById('sent').classList.contains('show')) && (JSON.parse(localStorage.getItem('glance.demo.sent')||'[]')).length === 0`,
        `({ url: location.pathname.split('/').pop(), sentShown: !!document.getElementById('sent') && document.getElementById('sent').classList.contains('show'), sentText: document.getElementById('sent') && document.getElementById('sent').textContent, reply: document.getElementById('sent') && document.getElementById('sent').dataset.text, store: JSON.parse(localStorage.getItem('glance.demo.sent')||'[]') })`,
      )
    }
    if (only.includes('B')) {
      await js('location.href = ' + JSON.stringify(demo('email.html?id=ana')))
      await sleep(300)
      await loaded('email.html')
      const g = await gazeAt('#when', 30, 0)
      await runScenario(
        'B',
        'schedule it',
        g,
        `(JSON.parse(localStorage.getItem('glance.demo.events')||'[]')).length === 0`,
        `({ url: location.pathname.split('/').pop(), saved: document.getElementById('saved') && document.getElementById('saved').textContent, events: JSON.parse(localStorage.getItem('glance.demo.events')||'[]') })`,
      )
    }

  }
  console.log('AGENT_E2E done')
  app.exit(0)
}
