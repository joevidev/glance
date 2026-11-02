// The fast model for typing (suggestions, word prediction). OpenAI only: the Fireworks account is suspended.
// Verified live 2026-11-02: gpt-5.4-mini accepts max_completion_tokens + response_format json_object + reasoning_effort "none"
// (about 1.0 to 1.6 s for 3 short replies). gpt-4.1-mini is faster (0.4 to 0.8 s) but rejects reasoning_effort.
import { makeClient, type ChatClient } from '@glance/brain'

export const FAST_DEFAULT = 'gpt-5.4-mini'

export function fastModel(): string {
  return process.env.GLANCE_FAST_MODEL || FAST_DEFAULT
}

let shared: ChatClient | null = null
export function fastClient(): ChatClient {
  if (!shared) shared = makeClient({ provider: 'openai', timeoutMs: 6000 })
  return shared
}

export interface FastResult {
  raw: string
  latencyMs: number
  model: string
}

/** One JSON-mode call. gpt-5 family: reasoning off for speed. If the model rejects a parameter, retry once without the extras. */
export async function fastJson(client: ChatClient, prompt: string, maxTokens: number, model = fastModel()): Promise<FastResult> {
  const t0 = performance.now()
  const base = { model, messages: [{ role: 'user' as const, content: prompt }], max_completion_tokens: maxTokens }
  const extras: Record<string, unknown> = { response_format: { type: 'json_object' } }
  if (/^gpt-5/.test(model)) extras.reasoning_effort = 'none'
  let res
  try {
    res = await client.chat.completions.create({ ...base, ...extras })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/400|unrecognized|unsupported|invalid/i.test(msg)) throw e
    res = await client.chat.completions.create(base)
  }
  return { raw: res.choices[0]?.message?.content ?? '', latencyMs: Math.round(performance.now() - t0), model }
}
