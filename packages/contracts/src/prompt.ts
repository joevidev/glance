// TypeScript twin of packages/lab/glance_lab/prompt.py. Must reproduce
// fixtures/prompt_golden.json byte for byte. Do not change the format here
// without changing the Python side and regenerating the fixture.
import intentTpl from '../prompts/intent.txt?raw'
import commandOnlyTpl from '../prompts/intent_command_only.txt?raw'
import type { Element, LiveCase } from './types'

/** Python 3 round(): half to even. JS Math.round rounds half up, so 300.5 differs. */
export function pyRound(x: number): number {
  const f = Math.floor(x)
  const diff = x - f
  let r: number
  if (diff < 0.5) r = f
  else if (diff > 0.5) r = f + 1
  else r = f % 2 === 0 ? f : f + 1
  return r === 0 ? 0 : r // normalise -0
}

/** Replace every occurrence without the `$&` expansion of String.replace. */
function sub(s: string, token: string, value: string): string {
  return s.split(token).join(value)
}

/** Python str.split() with no args collapses any whitespace run; join with one space. */
function collapse(s: string): string {
  return s.split(/[\s\u0085]+/).filter(Boolean).join(' ')
}

export function renderElement(e: Element): string {
  const name = collapse(String(e.name)).split('"').join("'")
  const { x, y, w, h } = e.box
  return `[${e.id}] ${e.role} "${name}" @${pyRound(x)},${pyRound(y)},${pyRound(w)},${pyRound(h)}`
}

export function renderElements(elements: Element[]): string {
  return elements.map(renderElement).join('\n')
}

export function buildPrompt(c: LiveCase, opts: { withGaze?: boolean } = {}): string {
  const withGaze = opts.withGaze ?? true
  const tpl = (withGaze ? intentTpl : commandOnlyTpl).replace(/\n+$/, '')
  let out = tpl
  out = sub(out, '{{width}}', String(c.viewport.w))
  out = sub(out, '{{height}}', String(c.viewport.h))
  out = sub(out, '{{command}}', c.command)
  out = sub(out, '{{elements}}', renderElements(c.elements))
  if (withGaze) {
    out = sub(out, '{{gaze_x}}', String(pyRound(c.gaze.x)))
    out = sub(out, '{{gaze_y}}', String(pyRound(c.gaze.y)))
  }
  return out
}

/** The exact assistant text used as the training target. Python json.dumps puts a space after the colon. */
export function completion(answer: number): string {
  return `{"target": ${answer}}`
}

/** Pull {"target": N} out of a model reply. null if it cannot be parsed. */
export function parseDecision(text: string | null | undefined): number | null {
  const m = /"target"\s*:\s*(-?\d+|null)/.exec(text ?? '')
  if (!m || m[1] === 'null') return null
  return parseInt(m[1]!, 10)
}
