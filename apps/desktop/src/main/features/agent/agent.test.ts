import { describe, expect, it, vi } from 'vitest'
import { IRREVERSIBLE_RE, MAX_STEPS, extractJson, isIrreversible, parseAction } from './actions'
import { runTask, type AgentDeps, type ModelStep, type Observation } from './loop'
import { askModel, buildUserPrompt } from './model'
import type { AgentAction, ConfirmRequest } from '../../../shared/agent'

const els = [
  { id: 0, role: 'link', name: 'Inbox', box: { x: 0, y: 0, w: 50, h: 20 } },
  { id: 1, role: 'textbox', name: 'Reply message', box: { x: 0, y: 30, w: 300, h: 100 } },
  { id: 2, role: 'button', name: 'Send reply', box: { x: 0, y: 140, w: 90, h: 30 } },
  { id: 3, role: 'button', name: 'Archive', box: { x: 100, y: 140, w: 90, h: 30 } },
]
const obsOf = (text = 'page', value = ''): Observation => ({ url: 'file:///reply.html', title: 'Reply', elements: els, text, fields: [{ name: 'Reply message', value }], viewport: { w: 900, h: 700 } })
const act = (a: Partial<AgentAction> & { action: AgentAction['action'] }): AgentAction => ({ target: null, text: null, reason: '', ...a })
const reply = (a: AgentAction): ModelStep => ({ parsed: { ok: true, action: a }, raw: JSON.stringify(a), ms: 5 })

/** A scripted "model" and a fake page: every executed action changes the page text so progress checks pass. */
function harness(script: (AgentAction | ModelStep)[], opts: { confirm?: (r: ConfirmRequest) => Promise<boolean>; maxSteps?: number; frozenPage?: boolean } = {}) {
  let i = 0
  let version = 0
  const executed: AgentAction[] = []
  const confirm = vi.fn(opts.confirm ?? (async () => true))
  const deps: AgentDeps = {
    model: { id: 'mock', provider: 'openai' },
    maxSteps: opts.maxSteps,
    startContext: async () => ({ pageText: 'start', gazeText: null, nearest: null }),
    observe: async () => obsOf(opts.frozenPage ? 'static' : `v${version}`),
    decide: async () => {
      const s = script[Math.min(i++, script.length - 1)]!
      return 'parsed' in s ? s : reply(s)
    },
    execute: async (a) => {
      executed.push(a)
      version++
      return { ok: true }
    },
    confirm,
    onState: () => {},
  }
  return { deps, executed, confirm }
}

describe('parseAction', () => {
  it('parses a strict JSON click', () => {
    const r = parseAction('{"action":"click","target":2,"text":null,"reason":"open it"}')
    expect(r).toEqual({ ok: true, action: { action: 'click', target: 2, text: null, reason: 'open it' } })
  })
  it('tolerates fences, prose and string targets', () => {
    const r = parseAction('Sure!\n```json\n{"action":"type","target":"1","text":"hi {there}","reason":"r"}\n```')
    expect(r).toMatchObject({ ok: true, action: { action: 'type', target: 1, text: 'hi {there}' } })
  })
  it('rejects garbage, unknown actions and missing fields', () => {
    expect(parseAction('hello').ok).toBe(false)
    expect(parseAction('{"action":"fly"}').ok).toBe(false)
    expect(parseAction('{"action":"click"}').ok).toBe(false)
    expect(parseAction('{"action":"type","target":1}').ok).toBe(false)
    expect(parseAction('{"action":"key","text":"Delete"}').ok).toBe(false)
    expect(parseAction('{"action":').ok).toBe(false)
  })
  it('normalizes key, scroll, done and ask', () => {
    expect(parseAction('{"action":"key","text":"enter"}')).toMatchObject({ ok: true, action: { text: 'Enter' } })
    expect(parseAction('{"action":"scroll","text":"UP"}')).toMatchObject({ ok: true, action: { text: 'up' } })
    expect(parseAction('{"action":"done","text":"all set"}')).toMatchObject({ ok: true, action: { action: 'done', text: 'all set' } })
    expect(parseAction('{"action":"ask","text":"which one?"}')).toMatchObject({ ok: true, action: { action: 'ask', text: 'which one?' } })
  })
  it('extractJson finds the first balanced object', () => {
    expect(extractJson('x {"a":{"b":"}"}} y {"c":1}')).toBe('{"a":{"b":"}"}}')
  })
})

describe('irreversible guard', () => {
  it('flags send/submit/save/pay/delete/confirm/buy by element name', () => {
    for (const n of ['Send reply', 'Submit', 'Save event', 'Pay now', 'Delete', 'Confirm booking', 'Buy it', 'SEND']) expect(IRREVERSIBLE_RE.test(n), n).toBe(true)
    for (const n of ['Archive', 'Reply', 'Calendar', 'Back to inbox', 'Event title']) expect(IRREVERSIBLE_RE.test(n), n).toBe(false)
  })
  it('only clicks and Enter are irreversible; typing and scrolling are not', () => {
    expect(isIrreversible(act({ action: 'click', target: 2 }), 'Send reply')).toBe(true)
    expect(isIrreversible(act({ action: 'click', target: 3 }), 'Archive')).toBe(false)
    expect(isIrreversible(act({ action: 'key', text: 'Enter' }), null)).toBe(true)
    expect(isIrreversible(act({ action: 'key', text: 'Tab' }), null)).toBe(false)
    expect(isIrreversible(act({ action: 'type', target: 1, text: 'send it' }), 'Reply message')).toBe(false)
  })
  it('pauses on Send, never executes it without a confirm, and runs it after one', async () => {
    const h = harness([act({ action: 'type', target: 1, text: 'Yes' }), act({ action: 'click', target: 2 }), act({ action: 'done', text: 'sent' })])
    let seenBeforeConfirm: AgentAction[] = []
    h.confirm.mockImplementation(async () => {
      seenBeforeConfirm = [...h.executed]
      return true
    })
    const st = await runTask(h.deps, 'reply yes', 'typed')
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.confirm.mock.calls[0]![0].actionName).toContain('Send reply')
    expect(seenBeforeConfirm.map((a) => a.action)).toEqual(['type']) // the click had NOT run when the card was shown
    expect(h.executed.map((a) => a.action)).toEqual(['type', 'click'])
    expect(st.status).toBe('done')
    expect(st.steps.find((s) => s.irreversible)?.waitMs).toBeGreaterThanOrEqual(0)
  })
  it('a declined confirm stops the task and the click never runs', async () => {
    const h = harness([act({ action: 'click', target: 2 }), act({ action: 'done' })], { confirm: async () => false })
    const st = await runTask(h.deps, 'send it', 'voice')
    expect(h.executed).toHaveLength(0)
    expect(st.status).toBe('cancelled')
    expect(st.steps[0]!.status).toBe('declined')
    expect(st.message).toMatch(/nothing was sent/i)
  })
  it('a confirm that throws counts as declined (never auto-confirms)', async () => {
    const h = harness([act({ action: 'click', target: 2 })], { confirm: async () => { throw new Error('ui gone') } })
    const st = await runTask(h.deps, 'x', 'typed')
    expect(h.executed).toHaveLength(0)
    expect(st.status).toBe('cancelled')
  })
  it('pressing Enter also needs a confirm', async () => {
    const h = harness([act({ action: 'key', text: 'Enter' }), act({ action: 'done' })], { confirm: async () => false })
    const st = await runTask(h.deps, 'x', 'typed')
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(st.status).toBe('cancelled')
  })
  it('a safe click does not ask', async () => {
    const h = harness([act({ action: 'click', target: 3 }), act({ action: 'done', text: 'ok' })])
    const st = await runTask(h.deps, 'archive', 'typed')
    expect(h.confirm).not.toHaveBeenCalled()
    expect(st.status).toBe('done')
  })
})

describe('step limit and stop conditions', () => {
  it('stops at 8 steps when the model never finishes', async () => {
    const h = harness([act({ action: 'scroll', text: 'down' })])
    const st = await runTask(h.deps, 'loop forever', 'typed')
    expect(MAX_STEPS).toBe(8)
    expect(h.executed).toHaveLength(8)
    expect(st.steps).toHaveLength(8)
    expect(st.status).toBe('max_steps')
  })
  it('honors a smaller maxSteps', async () => {
    const h = harness([act({ action: 'scroll', text: 'down' })], { maxSteps: 3 })
    const st = await runTask(h.deps, 'x', 'typed')
    expect(st.steps).toHaveLength(3)
    expect(st.status).toBe('max_steps')
  })
  it('stops on done and on ask without executing them', async () => {
    const d = harness([act({ action: 'done', text: 'finished' })])
    expect((await runTask(d.deps, 'x', 'typed')).message).toBe('finished')
    expect(d.executed).toHaveLength(0)
    const a = harness([act({ action: 'ask', text: 'which Ana?' })])
    const st = await runTask(a.deps, 'x', 'typed')
    expect(st.status).toBe('asked')
    expect(st.message).toBe('which Ana?')
  })
  it('stops as stuck after two actions that change nothing', async () => {
    const h = harness([act({ action: 'click', target: 3 })], { frozenPage: true })
    const st = await runTask(h.deps, 'x', 'typed')
    expect(st.status).toBe('stuck')
    expect(st.steps.length).toBeLessThanOrEqual(4)
  })
  it('a target id that is not on the page is an error step, not an action', async () => {
    const h = harness([act({ action: 'click', target: 99 }), act({ action: 'done', text: 'ok' })])
    const st = await runTask(h.deps, 'x', 'typed')
    expect(h.executed).toHaveLength(0)
    expect(st.steps[0]!.status).toBe('error')
    expect(st.status).toBe('done')
  })
  it('two unparsable replies in a row end the task with an error', async () => {
    const bad: ModelStep = { parsed: { ok: false, error: 'invalid JSON' }, raw: 'nope', ms: 3 }
    const st = await runTask(harness([bad]).deps, 'x', 'typed')
    expect(st.status).toBe('error')
  })
  it('a model error ends the task', async () => {
    const e: ModelStep = { parsed: { ok: false, error: 'model call failed' }, raw: '', ms: 1, error: 'boom' }
    const st = await runTask(harness([e]).deps, 'x', 'typed')
    expect(st.status).toBe('error')
    expect(st.message).toBe('boom')
  })
  it('accumulates tokens and records per-step model ms', async () => {
    const h = harness([{ ...reply(act({ action: 'done', text: 'k' })), tokensIn: 1000, tokensOut: 50, ms: 123 }])
    const st = await runTask(h.deps, 'x', 'typed')
    expect(st.tokensIn).toBe(1000)
    expect(st.steps[0]!.modelMs).toBe(123)
  })
})

describe('model request', () => {
  const input = { command: 'reply yes', obs: obsOf(), ctx: { pageText: 'From: Ana', gazeText: 'tomorrow at 3', nearest: 'Reply' }, history: [], notes: [] }
  const mock = (content: string) => {
    const create = vi.fn(async (_p: unknown) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 40 } }))
    return { create, client: { chat: { completions: { create } } } as never }
  }
  it('openai: no temperature, no max_tokens, max_completion_tokens, JSON mode, parses the action and usage', async () => {
    const { create, client } = mock('{"action":"click","target":3,"text":null,"reason":"r"}')
    const r = await askModel(input, { client, provider: 'openai', model: 'gpt-5.4-mini' })
    const call = create.mock.calls[0]![0] as Record<string, unknown>
    expect('temperature' in call).toBe(false)
    expect('max_tokens' in call).toBe(false)
    expect(call.max_completion_tokens).toBe(1024)
    expect(call.response_format).toEqual({ type: 'json_object' })
    expect(call.model).toBe('gpt-5.4-mini')
    expect(r.parsed).toMatchObject({ ok: true, action: { action: 'click', target: 3 } })
    expect(r.tokensIn).toBe(900)
  })
  it('drops a parameter the model rejects and retries once', async () => {
    let n = 0
    const create = vi.fn(async (p: Record<string, unknown>) => {
      n++
      if ('reasoning_effort' in p) throw new Error("400 Unsupported parameter: 'reasoning_effort'")
      return { choices: [{ message: { content: '{"action":"done","text":"ok"}' } }] }
    })
    const r = await askModel(input, { client: { chat: { completions: { create } } } as never, provider: 'openai', model: 'strict-model' })
    expect(n).toBe(2)
    expect(r.parsed.ok).toBe(true)
  })
  it('never throws: API failure comes back as error', async () => {
    const client = { chat: { completions: { create: async () => { throw new Error('network down') } } } } as never
    const r = await askModel(input, { client, provider: 'openai', model: 'm2' })
    expect(r.error).toBe('network down')
  })
  it('the prompt carries the start context, form values, element ids and history', () => {
    const p = buildUserPrompt({ ...input, history: [{ n: 1, action: 'click', target: 'Reply', text: null, result: 'ok' }] })
    expect(p).toContain('tomorrow at 3')
    expect(p).toContain('[2] button "Send reply"')
    expect(p).toContain('Reply message: (empty)')
    expect(p).toContain('1. click "Reply" -> ok')
  })
})
