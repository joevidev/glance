// Cursor magnet wiring: keeps the candidate list (Browse page DOM, or the frontmost app's AX tree) and feeds MagnetCore.
// The controller calls adjust() once per gaze frame; the list is refreshed only when a fixation has started (not per frame).
import { BrowserWindow } from 'electron'
import type { Browse } from '../../browse'
import { chooseSource, getDesktopElements, resolveMode } from '../ax'
import { MagnetCore, type MagnetCtx, type MagnetElement, type MagnetParams, type Pt } from './magnet'

export { DEFAULT_MAGNET, MagnetCore, distToBox, snapPoint } from './magnet'
export type { MagnetCtx, MagnetElement, MagnetParams } from './magnet'

export class Magnet {
  readonly core: MagnetCore
  private busy = false
  /** Last refresh cost in ms, for tuning (see README). */
  lastRefreshMs = 0
  lastSource: 'dom' | 'ax' | 'none' = 'none'

  constructor(private deps: { browse: Browse }, params: Partial<MagnetParams> = {}) {
    this.core = new MagnetCore(params)
  }

  adjust(raw: Pt, now: number, ctx: MagnetCtx): Pt {
    const out = this.core.adjust(raw, now, ctx)
    if (ctx.enabled && !ctx.blocked && !this.busy && this.core.wantsRefresh(now)) void this.refresh()
    return out
  }

  pointAround(ts: number, windowMs?: number): Pt | null {
    return this.core.pointAround(ts, windowMs)
  }

  private async refresh(): Promise<void> {
    this.busy = true
    const t0 = Date.now()
    this.core.markRefresh(t0)
    try {
      const els = await this.fetch()
      if (els) this.core.setElements(els, t0) // stamped with the START of the read: the page may have changed while it ran
    } catch {
      /* no candidates this time: the cursor just follows the gaze */
    } finally {
      this.lastRefreshMs = Date.now() - t0
      this.busy = false
    }
  }

  /** Candidates in global screen points, or null when there is no usable source right now. */
  private async fetch(): Promise<MagnetElement[] | null> {
    const { browse } = this.deps
    const own = BrowserWindow.getFocusedWindow() // one of Glance's own windows
    const src = chooseSource(resolveMode(), own !== null)
    if (src === 'dom') {
      this.lastSource = 'dom'
      if (!browse.isFrontAndVisible() || (own !== null && own !== browse.win)) return []
      const ex = await browse.extract()
      if (!ex) return []
      const out: MagnetElement[] = []
      for (const e of ex.elements) {
        const r = browse.toScreen(e.box)
        if (r) out.push({ id: e.id, box: { x: r.x, y: r.y, w: r.width, h: r.height } })
      }
      return out
    }
    this.lastSource = 'ax'
    const ax = await getDesktopElements()
    if (!ax.ok) return []
    return ax.elements.map((e) => ({ id: e.id, box: e.box }))
  }
}
