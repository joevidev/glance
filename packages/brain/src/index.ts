// The brain: gaze + command + on-screen elements -> the element the user means.
// Runs ONLY in the Electron main process. The API key never reaches a renderer.
import OpenAI from 'openai'
import { buildPrompt, parseDecision } from '@glance/contracts'
import type { Element, LiveCase } from '@glance/contracts'

export const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1'
export const DEFAULT_MODEL = 'accounts/fireworks/models/glm-5p3'

export interface IntentInput {
  viewport: { w: number; h: number }
  /** Gaze in viewport CSS px. Omit (or set withGaze:false) for the command-only prompt. */
  gaze?: { x: number; y: number } | null
  command: string
  elements: Element[]
}

/** The slice of the OpenAI client we use: lets tests inject a mock. */
export interface ChatClient {
  chat: {
    completions: {
      create(params: {
        model: string
        messages: { role: 'user'; content: string }[]
        temperature: number
        max_tokens: number
        [k: string]: unknown
      }): Promise<{ choices: { message?: { content?: string | null } | null }[] }>
    }
  }
}

export interface DecideOpts {
  client?: ChatClient
  apiKey?: string
  baseURL?: string
  model?: string
  /** GLM-5.3 is thinking-only: reasoning tokens count against max_tokens. 256 with effort 'low' returns in ~1s. */
  maxTokens?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | null
  withGaze?: boolean
  timeoutMs?: number
}

export interface Decision {
  /** Element id, or null when the reply could not be parsed. */
  target: number | null
  latencyMs: number
  raw: string
  model: string
  prompt: string
  error?: string
}

export function makeClient(opts: { apiKey?: string; baseURL?: string; timeoutMs?: number } = {}): ChatClient {
  const apiKey = opts.apiKey ?? process.env.FIREWORKS_API_KEY
  if (!apiKey) throw new Error('FIREWORKS_API_KEY is not set')
  return new OpenAI({
    apiKey,
    baseURL: opts.baseURL ?? FIREWORKS_BASE_URL,
    timeout: opts.timeoutMs ?? 20_000,
    maxRetries: 1,
  }) as unknown as ChatClient
}

export async function decideIntent(input: IntentInput, opts: DecideOpts = {}): Promise<Decision> {
  const model = opts.model ?? process.env.GLANCE_MODEL ?? DEFAULT_MODEL
  const withGaze = (opts.withGaze ?? true) && !!input.gaze
  const live: LiveCase = {
    viewport: input.viewport,
    gaze: input.gaze ?? { x: 0, y: 0 },
    command: input.command,
    elements: input.elements,
  }
  const prompt = buildPrompt(live, { withGaze })
  const t0 = performance.now()
  try {
    const client = opts.client ?? makeClient(opts)
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: opts.maxTokens ?? 256,
      ...(opts.reasoningEffort === null ? {} : { reasoning_effort: opts.reasoningEffort ?? 'low' }),
    })
    const raw = res.choices[0]?.message?.content ?? ''
    return { target: parseDecision(raw), latencyMs: Math.round(performance.now() - t0), raw, model, prompt }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { target: null, latencyMs: Math.round(performance.now() - t0), raw: '', model, prompt, error: msg }
  }
}

/** Baseline for the ablation: the element whose box is nearest to the gaze point (0 if the point is inside). */
export function nearestElement(gaze: { x: number; y: number }, elements: Element[]): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const e of elements) {
    const dx = Math.max(e.box.x - gaze.x, 0, gaze.x - (e.box.x + e.box.w))
    const dy = Math.max(e.box.y - gaze.y, 0, gaze.y - (e.box.y + e.box.h))
    const d = Math.hypot(dx, dy)
    if (d < bestD) {
      bestD = d
      best = e.id
    }
  }
  return best
}
