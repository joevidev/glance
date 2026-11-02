// Context for the reply suggestions: Browse page text + the element being looked at, or on the real desktop the frontmost app
// and any selected text. Main process only.
import { execFile } from 'node:child_process'
import { clipboard } from 'electron'
import type { Browse } from '../../browse'
import type { InputHelper } from '../../input'
import { clip, type SuggestContext } from './suggest'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Frontmost app name with lsappinfo (no permission prompt). */
export function frontmostApp(): Promise<string> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"'], { timeout: 800 }, (err, out) => {
      const m = !err && /"LSDisplayName"="([^"]*)"/.exec(String(out))
      resolve(m ? m[1]! : 'unknown app')
    })
  })
}

// runs inside the Browse page: visible text, the element under the gaze (viewport px), the focused field
const PAGE_JS = (gx: number | null, gy: number | null) => `(() => {
  const vh = window.innerHeight, vw = window.innerWidth
  let text = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode() && text.length < 2200) {
    const n = walker.currentNode, p = n.parentElement
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue
    const r = p.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue
    const t = (n.textContent || '').replace(/\\s+/g, ' ').trim()
    if (t) text += t + ' | '
  }
  let looking = ''
  const gx = ${gx === null ? 'null' : gx}, gy = ${gy === null ? 'null' : gy}
  if (gx !== null && gy !== null) {
    let el = document.elementFromPoint(gx, gy)
    while (el && el !== document.body && (el.innerText || '').trim().length < 12) el = el.parentElement
    if (el && el !== document.body) looking = (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 400)
  }
  const a = document.activeElement
  const field = a && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? (a.getAttribute('placeholder') || a.getAttribute('aria-label') || a.name || 'text field') + ' (typed so far: ' + (a.value || '').slice(-120) + ')' : ''
  return { title: document.title, text, looking, field }
})()`

export async function browseContext(browse: Browse, gazeScreen: { x: number; y: number } | null): Promise<SuggestContext | null> {
  const wc = browse.view?.webContents
  if (!wc || wc.isDestroyed()) return null
  try {
    const g = gazeScreen ? browse.toViewport(gazeScreen) : null
    const r = (await wc.executeJavaScript(PAGE_JS(g ? Math.round(g.x) : null, g ? Math.round(g.y) : null))) as { title: string; text: string; looking: string; field: string }
    return {
      kind: 'browse',
      app: `Glance Browse: ${r.title || 'page'}`,
      lookingAt: r.looking || undefined,
      pageText: clip(r.text, 1800),
      draft: r.field || undefined,
    }
  } catch {
    return null
  }
}

/** Selected text of the frontmost app via Cmd+C with a sentinel, restoring the clipboard. */
export async function selectedText(input: InputHelper): Promise<string | undefined> {
  const prev = await clipboard.readText()
  const sentinel = `__glance_${Date.now()}__`
  try {
    await clipboard.writeText(sentinel)
    await input.op({ op: 'key', key: 'c', modifiers: ['cmd'] }, 1500)
    await sleep(140)
    const got = await clipboard.readText()
    return got && got !== sentinel ? got : undefined
  } finally {
    await clipboard.writeText(prev)
  }
}

export async function desktopContext(input: InputHelper): Promise<SuggestContext> {
  const app = await frontmostApp()
  const selected = await selectedText(input).catch(() => undefined)
  return { kind: 'desktop', app, selected: selected ? clip(selected, 600) : undefined }
}
