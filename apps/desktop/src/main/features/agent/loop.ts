// The task loop: observe -> ask the model for ONE action -> guard -> execute -> re-observe. Pure (dependencies injected),
// so the step limit, the irreversible guard and the parsing are tested with a mocked model and no Electron.
import type { AgentAction, AgentState, AgentStep, ConfirmRequest } from '../../../shared/agent'
import type { ElementLite } from '../../../shared/ipc'
import { isIrreversible, MAX_STEPS, type ParseResult } from './actions'

export interface Observation {
  url: string
  title: string
  elements: ElementLite[]
  /** Visible text of the page (trimmed). */
  text: string
  /** Current value of every visible form field. */
  fields: { name: string; value: string }[]
  viewport: { w: number; h: number }
}

/** What the user was looking at when they spoke. Captured ONCE, before the first action (later pages differ). */
export interface StartContext {
  pageText: string
  gazeText: string | null
  nearest: string | null
}

export interface ModelStep {
  parsed: ParseResult
  raw: string
  ms: number
  tokensIn?: number
  tokensOut?: number
  error?: string
}

export interface HistoryItem {
  n: number
  action: string
  target: string | null
  text: string | null
  result: string
}

export interface AgentDeps {
  startContext(): Promise<StartContext>
  observe(): Promise<Observation>
  decide(i: { command: string; obs: Observation; ctx: StartContext; history: HistoryItem[]; notes: string[] }): Promise<ModelStep>
  execute(a: AgentAction, el: ElementLite | null): Promise<{ ok: boolean; error?: string }>
  /** Show the glass card and resolve true ONLY on a deliberate user confirm (left wink, Enter, button). Never auto. */
  confirm(req: ConfirmRequest): Promise<boolean>
  onState(s: AgentState): void
  model: { id: string; provider: string }
  now?: () => number
  maxSteps?: number
}

const sig = (o: Observation) => o.url + '|' + o.text + '|' + JSON.stringify(o.fields)

let nextTask = 1
let nextConfirm = 1

export async function runTask(deps: AgentDeps, command: string, source: 'typed' | 'voice'): Promise<AgentState> {
  const now = deps.now ?? Date.now
  const maxSteps = deps.maxSteps ?? MAX_STEPS
  const st: AgentState = {
    id: nextTask++,
    command,
    source,
    status: 'running',
    steps: [],
    pending: null,
    startedAt: now(),
    endedAt: null,
    model: deps.model.id,
    provider: deps.model.provider,
    tokensIn: 0,
    tokensOut: 0,
    message: '',
    maxSteps,
  }
  const emit = () => deps.onState(structuredClone(st))
  const finish = (status: AgentState['status'], message: string) => {
    st.status = status
    st.message = message
    st.pending = null
    st.endedAt = now()
    emit()
    return st
  }
  emit()
  const history: HistoryItem[] = []
  let ctx: StartContext
  try {
    ctx = await deps.startContext()
  } catch (e) {
    return finish('error', 'could not read the page: ' + msg(e))
  }
  let prevSig: string | null = null
  let noEffect = 0
  let badReplies = 0

  for (let n = 1; n <= maxSteps; n++) {
    const t0 = now()
    let obs: Observation
    try {
      obs = await deps.observe()
    } catch (e) {
      return finish('error', 'could not read the page: ' + msg(e))
    }
    const notes: string[] = []
    // verify progress: the previous action must have changed the page (url, text or a field value)
    const s = sig(obs)
    const last = history[history.length - 1]
    if (prevSig !== null && s === prevSig && last && last.result === 'ok') {
      last.result = 'no visible change on the page'
      const ls = st.steps[st.steps.length - 1]
      if (ls) ls.status = 'noeffect'
      noEffect++
      notes.push('The previous action had no visible effect. Try a different element or action.')
      if (noEffect >= 2) {
        emit()
        return finish('stuck', 'Two actions in a row changed nothing. Stopping.')
      }
    } else if (prevSig !== null && s !== prevSig) noEffect = 0
    prevSig = s

    const m = await deps.decide({ command, obs, ctx, history, notes })
    st.tokensIn += m.tokensIn ?? 0
    st.tokensOut += m.tokensOut ?? 0
    if (m.error) {
      st.steps.push(mkStep(n, 'ask', null, null, '', m.ms, 0, 'error', m.error))
      return finish('error', m.error)
    }
    if (!m.parsed.ok) {
      st.steps.push(mkStep(n, 'ask', null, null, '', m.ms, 0, 'error', 'unparsable reply: ' + m.parsed.error))
      history.push({ n, action: 'invalid reply', target: null, text: null, result: m.parsed.error })
      if (++badReplies >= 2) return finish('error', 'The model did not return a valid action twice: ' + m.parsed.error)
      emit()
      continue
    }
    const a = m.parsed.action
    const el = a.target === null ? null : (obs.elements.find((e) => e.id === a.target) ?? null)
    const step = mkStep(n, a.action, el?.name ?? null, a.text, a.reason, m.ms, 0, 'ok')
    st.steps.push(step)

    if (a.action === 'done') {
      step.status = 'done'
      step.execMs = now() - t0 - m.ms
      return finish('done', a.text || 'Done')
    }
    if (a.action === 'ask') {
      step.status = 'ask'
      return finish('asked', a.text || 'I need more information')
    }
    if ((a.action === 'click' || a.action === 'type') && !el) {
      step.status = 'error'
      step.note = `target ${a.target} is not on the page`
      history.push({ n, action: a.action, target: null, text: a.text, result: `error: no element with id ${a.target}` })
      emit()
      continue
    }

    // THE GUARD: irreversible actions never run without a deliberate user confirm
    step.irreversible = isIrreversible(a, el?.name ?? null)
    if (step.irreversible) {
      const req: ConfirmRequest = {
        id: nextConfirm++,
        title: a.action === 'key' ? `Press ${a.text}?` : `${cap(el?.name ?? 'this')}?`,
        detail: a.reason || `${a.action} ${el?.name ?? ''}`.trim(),
        actionName: a.action === 'key' ? `key ${a.text}` : `click “${el?.name}”`,
        hint: 'Left wink or Enter to confirm · Esc or right wink to cancel',
      }
      st.status = 'confirming'
      st.pending = req
      step.status = 'confirm'
      emit()
      const w0 = now()
      let ok = false
      try {
        ok = await deps.confirm(req)
      } catch {
        ok = false
      }
      step.waitMs = now() - w0
      st.pending = null
      if (!ok) {
        step.status = 'declined'
        return finish('cancelled', `Cancelled before “${el?.name ?? a.text}”. Nothing was sent or saved.`)
      }
      st.status = 'running'
    }

    const e0 = now()
    const r = await deps.execute(a, el).catch((e) => ({ ok: false, error: msg(e) }))
    step.execMs = now() - e0
    if (!r.ok) {
      step.status = 'error'
      step.note = r.error
      history.push({ n, action: a.action, target: el?.name ?? null, text: a.text, result: 'error: ' + (r.error ?? 'failed') })
    } else {
      step.status = 'ok'
      history.push({ n, action: a.action, target: el?.name ?? null, text: a.text, result: 'ok' })
    }
    emit()
  }
  return finish('max_steps', `Stopped after ${maxSteps} steps without finishing.`)
}

function mkStep(n: number, action: AgentStep['action'], target: string | null, text: string | null, reason: string, modelMs: number, execMs: number, status: AgentStep['status'], note?: string): AgentStep {
  return { n, action, target, text, reason, modelMs, execMs, waitMs: 0, irreversible: false, status, ...(note ? { note } : {}) }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
