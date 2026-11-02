// The model call for ONE agent step. Main process only: the key never leaves it.
// Dev default is gpt-5.4-mini (GLANCE_AGENT_MODEL overrides). The openai path sends NO temperature and NO max_tokens
// (reasoning-era models reject them), only max_completion_tokens, like packages/brain.
import { makeClient, resolveProvider, resolveModel, type ChatClient, type Provider } from '@glance/brain'
import { parseAction } from './actions'
import type { HistoryItem, ModelStep, Observation, StartContext } from './loop'

export const AGENT_DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini'

export function resolveAgentModel(provider: Provider = resolveProvider()): string {
  return process.env.GLANCE_AGENT_MODEL ?? (provider === 'openai' ? AGENT_DEFAULT_OPENAI_MODEL : resolveModel(provider))
}

export const SYSTEM_PROMPT = `You are Glance, an assistant that operates a web page for the user. The user looks at something and says a short command; you finish the task one action at a time.
Reply with ONE JSON object only, no prose:
{"action":"click"|"type"|"key"|"scroll"|"done"|"ask","target":<element id or null>,"text":<string or null>,"reason":<short why>}
- click: target = id of an element in ELEMENTS. type: target = id of a textbox, text = the full text to put in it (replaces what is there). key: text = Enter, Tab or Escape. scroll: text = "down" or "up". done: the task is finished, text = one sentence saying what happened. ask: you need information only the user has, text = the question.
- Use ONLY ids from the current ELEMENTS list; ids change after every action. One action per reply.
- Look at FORM VALUES and HISTORY: never repeat an action that already worked and never retype a field that is already right.
- Say done only after the final result is visible on the page (a "Sent" confirmation, a "Saved:" line). Clicking the final button is not done until you see it worked.
- Today is Monday 2026-11-02, so "tomorrow" is 2026-11-03. Date fields take YYYY-MM-DD and time fields HH:MM in 24 hour time (3 PM = 15:00).
- Write messages as the user (Joel): short, natural, first person, no placeholders, no subject line. Take names, addresses, dates and times from the page or from WHAT THE USER WAS LOOKING AT, never invent them.
- "this", "it" and "that" mean what the user was looking at when they spoke. For "schedule it" the event comes from that email: a short title from its topic, the date and time from the sentence the user was looking at, and the invitee is the sender (the address on the From line of the PAGE THE USER WAS ON).
- Use ask ONLY when the needed information is nowhere in the page text or the context. Never ask for something the page already shows.`

export function buildUserPrompt(i: { command: string; obs: Observation; ctx: StartContext; history: HistoryItem[]; notes: string[] }): string {
  const els = i.obs.elements.map((e) => `[${e.id}] ${e.role} "${e.name}"`).join('\n')
  const fields = i.obs.fields.length ? i.obs.fields.map((f) => `- ${f.name}: ${f.value ? JSON.stringify(f.value) : '(empty)'}`).join('\n') : '(none)'
  const hist = i.history.length ? i.history.map((h) => `${h.n}. ${h.action}${h.target ? ` "${h.target}"` : ''}${h.text ? ` ${JSON.stringify(h.text.slice(0, 120))}` : ''} -> ${h.result}`).join('\n') : '(none yet)'
  return [
    `TASK: ${i.command}`,
    `WHAT THE USER WAS LOOKING AT when they spoke: ${i.ctx.gazeText ? JSON.stringify(i.ctx.gazeText) : '(no gaze text)'}${i.ctx.nearest ? `; nearest clickable: "${i.ctx.nearest}"` : ''}`,
    `PAGE THE USER WAS ON when they spoke:\n${i.ctx.pageText}`,
    `--- CURRENT PAGE: ${i.obs.title} (${i.obs.url.split('/').slice(-1)[0]})`,
    i.obs.text,
    `FORM VALUES:\n${fields}`,
    `ELEMENTS:\n${els}`,
    `HISTORY:\n${hist}`,
    ...i.notes.map((n) => `NOTE: ${n}`),
    'Reply with the next JSON action.',
  ].join('\n')
}

// params a model may refuse: dropped on a 400 naming them, remembered per model
const refused = new Map<string, Set<string>>()

export interface AskOpts {
  client?: ChatClient
  provider?: Provider
  model?: string
}

export async function askModel(i: Parameters<typeof buildUserPrompt>[0], opts: AskOpts = {}): Promise<ModelStep> {
  const provider = opts.provider ?? resolveProvider()
  const model = opts.model ?? resolveAgentModel(provider)
  const t0 = performance.now()
  const ms = () => Math.round(performance.now() - t0)
  let client: ChatClient
  try {
    client = opts.client ?? makeClient({ provider, timeoutMs: 30_000 })
  } catch (e) {
    return { parsed: { ok: false, error: 'no client' }, raw: '', ms: 0, error: e instanceof Error ? e.message : String(e) }
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(i) },
  ]
  const skip = refused.get(model) ?? new Set<string>()
  refused.set(model, skip)
  for (let attempt = 0; attempt < 3; attempt++) {
    const extras: Record<string, unknown> = {}
    if (!skip.has('response_format')) extras.response_format = { type: 'json_object' }
    if (provider === 'openai' && !skip.has('reasoning_effort')) extras.reasoning_effort = process.env.GLANCE_AGENT_EFFORT ?? 'low'
    const params =
      provider === 'openai'
        ? { max_completion_tokens: 1024, ...extras }
        : { temperature: 0, max_tokens: 512, ...extras }
    try {
      const res = (await client.chat.completions.create({ model, messages: messages as never, ...params })) as {
        choices: { message?: { content?: string | null } | null }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const raw = res.choices[0]?.message?.content ?? ''
      return { parsed: parseAction(raw), raw, ms: ms(), tokensIn: res.usage?.prompt_tokens, tokensOut: res.usage?.completion_tokens }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      const bad = ['response_format', 'reasoning_effort'].find((p) => m.includes(p) && !skip.has(p))
      if (bad) {
        skip.add(bad)
        continue
      }
      return { parsed: { ok: false, error: 'model call failed' }, raw: '', ms: ms(), error: m }
    }
  }
  return { parsed: { ok: false, error: 'model call failed' }, raw: '', ms: ms(), error: 'model rejected the request parameters' }
}
