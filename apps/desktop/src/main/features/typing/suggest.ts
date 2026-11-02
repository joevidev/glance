// Three reply suggestions from the current context, as strict JSON from the fast model.
import type { ChatClient } from '@glance/brain'
import type { SuggestContextInfo, SuggestResult } from '../../../shared/typing'
import { fastJson, fastModel } from './model'

export interface SuggestContext extends SuggestContextInfo {
  /** Visible text of the Browse page (trimmed). */
  pageText?: string
  /** What the user is typing already, if anything. */
  draft?: string
}

export const FALLBACK_REPLIES = ['Yes, that works for me.', 'Thanks, I will get back to you soon.', 'Can you tell me a bit more?']
const MAX_REPLY = 240

export function clip(s: string | undefined, n: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function buildSuggestPrompt(c: SuggestContext): string {
  const lines = [
    'You write quick replies for a person who types with their eyes, so every reply must be short, natural and ready to send as is.',
    'Return ONLY a JSON object, no prose, no code fences: {"replies":["...","...","..."]}',
    'Exactly 3 replies, each under 120 characters, first person, plain text, different intents (for example agree, ask a question, decline politely or defer). No emoji.',
    '',
    `Frontmost app: ${c.app || 'unknown'}`,
  ]
  if (c.lookingAt) lines.push(`The user is looking at: ${clip(c.lookingAt, 400)}`)
  if (c.selected) lines.push(`Selected text: ${clip(c.selected, 400)}`)
  if (c.pageText) lines.push(`Visible page text: ${clip(c.pageText, 1500)}`)
  if (c.draft) lines.push(`Already typed: ${clip(c.draft, 200)}`)
  return lines.join('\n')
}

/** Pull the JSON object out of a model reply (tolerates code fences and a little prose). */
export function extractJson(raw: string): unknown {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(s)
  } catch {
    /* fall through */
  }
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1))
    } catch {
      /* fall through */
    }
  }
  const c = s.indexOf('[')
  const d = s.lastIndexOf(']')
  if (c >= 0 && d > c) {
    try {
      return JSON.parse(s.slice(c, d + 1))
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Strict parse: {"replies":[...]} (also "suggestions") or a bare array. Cleans, dedupes, caps at 3. Never throws. */
export function parseSuggestions(raw: string): string[] {
  const j = extractJson(raw)
  const arr = Array.isArray(j)
    ? j
    : j && typeof j === 'object'
      ? ((j as Record<string, unknown>).replies ?? (j as Record<string, unknown>).suggestions ?? (j as Record<string, unknown>).options)
      : null
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  for (const x of arr) {
    const t = typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : ''
    const clean = t.replace(/\s+/g, ' ').trim().slice(0, MAX_REPLY)
    if (clean && !out.some((o) => o.toLowerCase() === clean.toLowerCase())) out.push(clean)
    if (out.length === 3) break
  }
  return out
}

export function padReplies(items: string[]): string[] {
  const out = [...items]
  for (const f of FALLBACK_REPLIES) if (out.length < 3 && !out.includes(f)) out.push(f)
  return out.slice(0, 3)
}

export async function suggestReplies(ctx: SuggestContext, opts: { client: ChatClient; model?: string }): Promise<SuggestResult> {
  const model = opts.model ?? fastModel()
  const info: SuggestContextInfo = { kind: ctx.kind, app: ctx.app, lookingAt: ctx.lookingAt ? clip(ctx.lookingAt, 160) : undefined, selected: ctx.selected ? clip(ctx.selected, 160) : undefined }
  const t0 = performance.now()
  try {
    const r = await fastJson(opts.client, buildSuggestPrompt(ctx), 220, model)
    const items = parseSuggestions(r.raw)
    if (items.length === 0) return { items: padReplies([]), latencyMs: r.latencyMs, model: r.model, source: 'offline', error: 'model reply had no usable suggestions', context: info }
    return { items: padReplies(items), latencyMs: r.latencyMs, model: r.model, source: 'model', context: info }
  } catch (e) {
    return { items: padReplies([]), latencyMs: Math.round(performance.now() - t0), model, source: 'offline', error: e instanceof Error ? e.message : String(e), context: info }
  }
}
