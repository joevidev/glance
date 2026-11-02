// GLANCE_TYPING_E2E=1: end-to-end check of Typing mode in the real app. The gaze is faked as a point on the panel (the real dwell logic in the
// renderer fires), the text is typed by the native helper (CGEvent) into an <input> on test-page.html inside Browse, then read back.
// One live fast-model call for the replies (+ a few tiny prediction calls). Exit code 0 = all checks passed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { repoRoot } from '../../env'
import type { Browse } from '../../browse'
import type { Controller } from '../../controller'
import type { InputHelper } from '../../input'
import type { Typing } from './index'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runTypingE2E(o: { browse: Browse; controller: Controller; input: InputHelper; typing: Typing; outDir: string }): Promise<void> {
  const { browse, typing } = o
  const out = join(repoRoot(), 'apps/desktop/.screens')
  mkdirSync(out, { recursive: true })
  const checks: { name: string; ok: boolean; detail?: string }[] = []
  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok, detail })
    console.log(`TYPING_E2E ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`)
  }
  const field = async () => String(await browse.view!.webContents.executeJavaScript(`document.getElementById('field').value`))
  const rectOf = async (id: string) => {
    const r = (await typing.win!.webContents.executeJavaScript(
      `(() => { const e = document.querySelector('[data-gaze="${id}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )) as { x: number; y: number } | null
    if (!r) return null
    const b = typing.win!.getBounds()
    return { x: b.x + r.x, y: b.y + r.y }
  }
  const dwellOn = async (id: string, ms = 1250) => {
    const r = await rectOf(id)
    if (!r) return check(`target ${id} exists`, false)
    typing.gazeOverride = r
    await sleep(ms / 2)
    if (process.env.TYPING_E2E_DEBUG) {
      const b = typing.win!.getBounds()
      console.log('DEBUG', id, JSON.stringify({ r, b }), await typing.win!.webContents.executeJavaScript(`(() => { const x=${r.x - 0}-${b.x}, y=${r.y}-${b.y}; return JSON.stringify({x,y,hit: document.elementFromPoint(x,y)?.closest('[data-gaze]')?.dataset.gaze, buf: document.querySelector('[data-testid=buffer]')?.textContent, dot: !!document.querySelector('[data-testid=gazedot]'), hot: document.querySelector('[data-hot]')?.getAttribute('data-hot'), vis: document.visibilityState}) })()`))
    }
    await sleep(ms / 2)
    typing.gazeOverride = { x: -80, y: -80 }
    await sleep(120)
  }
  const shot = async (name: string) => {
    const w = typing.win!
    await w.webContents.executeJavaScript(`document.documentElement.style.setProperty('background','#3a3a3a','important')`)
    await sleep(150)
    writeFileSync(join(out, name), (await w.webContents.capturePage()).toPNG())
    await w.webContents.executeJavaScript(`document.documentElement.style.removeProperty('background')`)
  }

  try {
    await sleep(3000)
    browse.open('file://' + join(repoRoot(), 'apps/desktop/src/main/features/typing/test-page.html'))
    await sleep(2500)
    app.focus({ steal: true })
    browse.win?.show()
    browse.win?.focus()
    browse.view?.webContents.focus()
    await browse.view!.webContents.executeJavaScript(`document.getElementById('field').focus()`)
    await sleep(500)

    typing.open()
    const t0 = Date.now()
    while (!typing.last() && Date.now() - t0 < 12000) await sleep(100)
    const sug = typing.last()
    check('three suggestions came back', !!sug && sug.items.length === 3 && sug.source === 'model', sug ? `${sug.latencyMs} ms, ${sug.model}, source ${sug.source}${sug.error ? ', error ' + sug.error : ''}` : 'none')
    check('context came from the Browse page', sug?.context.kind === 'browse', JSON.stringify(sug?.context).slice(0, 200))
    check('page text reached the model (replies mention dinner/Friday/7)', !!sug?.items.some((s) => /dinner|friday|7|italian|free|work|sounds|love/i.test(s)), sug?.items.join(' | '))
    await sleep(600)
    await shot('typing-replies.png')
    // the panel must not have taken focus; make sure the Browse input is the focused field again before the dwell
    for (let i = 0; i < 15 && !browse.view?.webContents.isFocused(); i++) {
      app.focus({ steal: true })
      browse.win?.show()
      browse.win?.focus()
      browse.view?.webContents.focus()
      await browse.view!.webContents.executeJavaScript(`document.getElementById('field').focus()`)
      await sleep(250)
    }

    // 1. dwell on the first reply: it must land in the Browse input
    const before = await field()
    if (process.env.TYPING_E2E_DEBUG) {
      const { frontmostApp } = await import('./context')
      console.log('DEBUG focus', JSON.stringify({ front: await frontmostApp(), winFocused: browse.win?.isFocused(), viewFocused: browse.view?.webContents.isFocused(), active: await browse.view!.webContents.executeJavaScript('document.activeElement && document.activeElement.id'), trusted: o.input.trusted, wins: BrowserWindow.getAllWindows().map((w) => `${w.getTitle()}|focused=${w.isFocused()}|vis=${w.isVisible()}|focusable=${w.isFocusable()}`) }))
    }
    await dwellOn('s:0')
    const after = await field()
    check('dwell on reply 1 typed it into the Browse input', before === '' && after === sug?.items[0], `field="${after}"`)

    // 2. gaze keyboard: switch mode, type "hi " then a predicted word, then backspace
    await dwellOn('m:keys', 1300)
    await sleep(400)
    check('window grew for the keyboard', typing.win!.getBounds().height > 450, String(typing.win!.getBounds().height))
    const base = await field()
    await dwellOn('k:h', 1100)
    await dwellOn('k:i', 1100)
    await dwellOn('k:space', 1100)
    const hi = await field()
    check('gaze keys typed "hi "', hi === base + 'hi ', `field tail="${hi.slice(-8)}"`)
    await sleep(1500) // let a model prediction arrive
    await shot('typing-keys.png')
    const w0 = (await typing.win!.webContents.executeJavaScript(`document.querySelector('[data-gaze="w:0"]')?.textContent || ''`)) as string
    await dwellOn('w:0', 1100)
    const withWord = await field()
    check('predicted word typed', w0.length > 0 && withWord === hi + w0 + ' ', `word="${w0}" field tail="${withWord.slice(-14)}"`)
    await dwellOn('k:back', 1100)
    const bs = await field()
    check('backspace removed one char', bs === withWord.slice(0, -1), `field tail="${bs.slice(-14)}"`)

    // 3. counters
    const st = typing.stats.snapshot()
    check('counters: chars > keystrokes and wpm measured', st.chars > st.keystrokes && st.wpm > 0, JSON.stringify({ chars: st.chars, keystrokes: st.keystrokes, wpm: st.wpm, keyboardWpm: st.keyboardWpm, cpk: st.charsPerKeystroke }))
    typing.gazeOverride = null
    typing.close()
    const final = await field()
    writeFileSync(join(out, 'typing-e2e.json'), JSON.stringify({ checks, stats: st, suggestions: sug, finalField: final }, null, 2))
  } catch (e) {
    check('no exception', false, e instanceof Error ? e.stack : String(e))
  }
  const failed = checks.filter((c) => !c.ok).length
  console.log(`TYPING_E2E DONE ${checks.length - failed}/${checks.length} passed`)
  app.exit(failed ? 1 : 0)
}
