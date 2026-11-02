// Desktop elements: the Accessibility tree of whatever app is in front (packages/ax, Swift), same schema as the DOM extractor.
// GLANCE_ELEMENTS=auto|ax|dom  (default auto: Glance's own window focused -> DOM extractor, otherwise AX).
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { decideIntent, nearestElement, resolveModel, resolveProvider } from '@glance/brain'
import { repoRoot } from '../../env'
import type { ElementLite, IntentResult, Settings } from '../../../shared/ipc'
import { chooseSource, parseAxOutput, resolveMode, type AxResult, type ElementsMode } from './parse'

export { chooseSource, parseAxOutput, resolveMode } from './parse'
export type { AxResult, ElementsMode } from './parse'

function axBin(): string {
  return join(repoRoot(), 'packages/ax/bin/glance-ax')
}

let buildTried = false
function ensureBuilt(): Promise<boolean> {
  if (existsSync(axBin())) return Promise.resolve(true)
  if (buildTried) return Promise.resolve(false)
  buildTried = true
  return new Promise((res) => {
    execFile('node', [join(repoRoot(), 'packages/ax/scripts/build.mjs')], { timeout: 120000 }, () => res(existsSync(axBin())))
  })
}

/** Run `glance-ax <args>` and parse. Never throws; a missing binary or permission becomes {ok:false, error}. */
export async function runAx(args: string[], timeoutMs = 2500): Promise<AxResult> {
  if (!(await ensureBuilt())) {
    return { ok: false, trusted: true, error: 'glance-ax is not built (needs swiftc). Run: pnpm --filter @glance/ax build', elements: [] }
  }
  return new Promise<AxResult>((resolve) => {
    execFile(axBin(), args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
      resolve(parseAxOutput(String(stdout ?? '')))
    })
  })
}

/** Elements of the frontmost app's focused window, boxes in global screen points. */
export function getDesktopElements(): Promise<AxResult> {
  return runAx(['elements'])
}

/** True when the intent should read the screen through AX instead of the Browse page. */
export function useAxNow(): boolean {
  const focused = BrowserWindow.getFocusedWindow() !== null
  return chooseSource(resolveMode(), focused) === 'ax'
}

/** Same flow as Browse.decide (gaze in screen points + command + elements -> decideIntent), but over AX elements.
 *  The prompt and the parser are the shared ones, untouched. Does NOT click. */
export async function decideDesktop(args: {
  command: string
  source: 'typed' | 'voice'
  gazeScreen: { x: number; y: number } | null
  settings: Settings
}): Promise<IntentResult> {
  const t0 = Date.now()
  const provider = resolveProvider()
  const empty: IntentResult = {
    ts: t0, command: args.command, source: args.source, modelPick: null, nearestPick: null, actedOn: null,
    pickMode: args.settings.pick, latencyMs: 0, raw: '', model: resolveModel(provider), provider,
    elementCount: 0, gaze: null, viewport: null, element: null, nearestElement: null, modelElement: null,
  }
  const ax = await getDesktopElements()
  if (!ax.ok) return { ...empty, error: ax.error ?? 'could not read the screen' }
  const size = screen.getPrimaryDisplay().size
  const viewport = { w: Math.round(size.width), h: Math.round(size.height) }
  const els = ax.elements
  const byId = (id: number | null): ElementLite | null => (id === null ? null : (els.find((e) => e.id === id) ?? null))
  const gaze = args.gazeScreen
  const nearestPick = gaze ? nearestElement(gaze, els) : null
  const base = { ...empty, elementCount: els.length, gaze, viewport, nearestPick, nearestElement: byId(nearestPick) }
  if (els.length === 0) return { ...base, error: `No clickable elements found in ${ax.app ?? 'the front app'}.` }
  const d = await decideIntent({ viewport, gaze, command: args.command, elements: els }, { withGaze: args.settings.withGaze && !!gaze })
  const acted = args.settings.pick === 'nearest' ? nearestPick : d.target
  return {
    ...base,
    modelPick: d.target,
    modelElement: byId(d.target),
    actedOn: byId(acted) ? acted : null,
    latencyMs: d.latencyMs,
    raw: d.raw,
    model: d.model,
    provider: d.provider,
    element: byId(acted),
    error: d.error,
  }
}
