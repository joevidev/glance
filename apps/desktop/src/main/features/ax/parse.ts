// Pure helpers for the glance-ax output (no Electron imports, unit-testable).
import type { ElementLite } from '../../../shared/ipc'

export type ElementsMode = 'auto' | 'ax' | 'dom'

export function resolveMode(v: string | undefined = process.env.GLANCE_ELEMENTS): ElementsMode {
  const s = (v ?? 'auto').trim().toLowerCase()
  return s === 'ax' || s === 'dom' ? s : 'auto'
}

export interface AxResult {
  ok: boolean
  /** false = macOS Accessibility permission is missing for the process that runs glance-ax. */
  trusted: boolean
  error?: string
  app?: string
  pid?: number
  windowTitle?: string
  window?: { x: number; y: number; w: number; h: number } | null
  elements: ElementLite[]
  ms?: number
  nodes?: number
  truncated?: boolean
}

const MISSING = 'Accessibility permission is missing: allow Electron (and your terminal) in System Settings > Privacy & Security > Accessibility.'

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Parse and validate one element against the shared schema; null if it does not conform. */
export function parseElement(raw: unknown): ElementLite | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const b = r.box as Record<string, unknown> | undefined
  const id = num(r.id), x = num(b?.x), y = num(b?.y), w = num(b?.w), h = num(b?.h)
  if (id === null || !Number.isInteger(id) || id < 0 || typeof r.role !== 'string' || typeof r.name !== 'string') return null
  if (x === null || y === null || w === null || h === null || r.name.length > 80) return null
  return { id, role: r.role, name: r.name, box: { x, y, w, h } }
}

export function parseAxOutput(stdout: string): AxResult {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(stdout.trim().split('\n').pop() ?? '') as Record<string, unknown>
  } catch {
    return { ok: false, trusted: true, error: 'glance-ax returned no JSON', elements: [] }
  }
  if (j.trusted === false) return { ok: false, trusted: false, error: typeof j.error === 'string' ? j.error : MISSING, elements: [] }
  if (j.ok === false) return { ok: false, trusted: true, error: typeof j.error === 'string' ? j.error : 'glance-ax failed', elements: [] }
  const list = Array.isArray(j.elements) ? j.elements : []
  const elements = list.map(parseElement).filter((e): e is ElementLite => e !== null)
  return {
    ok: true,
    trusted: true,
    app: typeof j.app === 'string' ? j.app : undefined,
    pid: num(j.pid) ?? undefined,
    windowTitle: typeof j.windowTitle === 'string' ? j.windowTitle : undefined,
    window: (j.window as AxResult['window']) ?? null,
    elements,
    ms: num(j.ms) ?? undefined,
    nodes: num(j.nodes) ?? undefined,
    truncated: j.truncated === true,
  }
}

/** Which source to use. `browseFocused`: one of Glance's own windows has focus (Browse or dashboard). */
export function chooseSource(mode: ElementsMode, browseFocused: boolean): 'ax' | 'dom' {
  if (mode === 'ax') return 'ax'
  if (mode === 'dom') return 'dom'
  return browseFocused ? 'dom' : 'ax'
}
