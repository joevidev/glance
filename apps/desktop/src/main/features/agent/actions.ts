// Parsing the model's single action and the irreversible-action guard. Pure: no electron imports.
import type { AgentAction, AgentActionName } from '../../../shared/agent'

export const MAX_STEPS = 8

/** Anything whose target name matches this cannot be undone: the loop must stop and ask the user. */
export const IRREVERSIBLE_RE = /send|submit|save|pay|delete|confirm|buy/i

const ACTIONS: AgentActionName[] = ['click', 'type', 'key', 'scroll', 'done', 'ask']
const KEYS = ['Enter', 'Tab', 'Escape', 'PageDown', 'PageUp']

export type ParseResult = { ok: true; action: AgentAction } | { ok: false; error: string }

/** Pull the first balanced {...} out of a reply (models sometimes add fences or prose). */
export function extractJson(raw: string): string | null {
  const s = raw.replace(/```(?:json)?/gi, '')
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]!
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1)
  }
  return null
}

export function parseAction(raw: string): ParseResult {
  const j = extractJson(raw ?? '')
  if (!j) return { ok: false, error: 'no JSON object in the reply' }
  let o: Record<string, unknown>
  try {
    o = JSON.parse(j) as Record<string, unknown>
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }
  const action = typeof o.action === 'string' ? (o.action.toLowerCase().trim() as AgentActionName) : undefined
  if (!action || !ACTIONS.includes(action)) return { ok: false, error: `unknown action ${JSON.stringify(o.action)}` }
  let target: number | null = null
  if (typeof o.target === 'number' && Number.isInteger(o.target)) target = o.target
  else if (typeof o.target === 'string' && /^\d+$/.test(o.target.trim())) target = Number(o.target.trim())
  const text = typeof o.text === 'string' ? o.text : o.text == null ? null : String(o.text)
  const reason = typeof o.reason === 'string' ? o.reason.slice(0, 200) : ''
  if ((action === 'click' || action === 'type') && target === null) return { ok: false, error: `${action} needs an integer target` }
  if (action === 'type' && text === null) return { ok: false, error: 'type needs text' }
  if (action === 'key') {
    const k = KEYS.find((x) => x.toLowerCase() === (text ?? '').trim().toLowerCase())
    if (!k) return { ok: false, error: `key must be one of ${KEYS.join(', ')}` }
    return { ok: true, action: { action, target: null, text: k, reason } }
  }
  if (action === 'scroll') {
    return { ok: true, action: { action, target: null, text: /up/i.test(text ?? '') ? 'up' : 'down', reason } }
  }
  if (action === 'done' || action === 'ask') return { ok: true, action: { action, target: null, text: text ?? '', reason } }
  return { ok: true, action: { action, target, text, reason } }
}

/** True when running this action could send, save, pay or delete something. Pressing Enter always counts. */
export function isIrreversible(a: AgentAction, targetName: string | null): boolean {
  if (a.action === 'key') return a.text === 'Enter'
  if (a.action === 'click') return !!targetName && IRREVERSIBLE_RE.test(targetName)
  return false
}
