// Word prediction for the gaze keyboard: the fast model when online, a small offline frequency list otherwise.
// Offline list lives in offline.ts (re-exported here).
import type { ChatClient } from '@glance/brain'
import type { PredictResult } from '../../../shared/typing'
import { extractJson } from './suggest'
import { offlinePredict, splitContext, wordInsertion } from './offline'
import { fastJson, fastModel } from './model'

export function buildPredictPrompt(text: string): string {
  const { prefix } = splitContext(text)
  return [
    'You are the word predictor of an eye-typing keyboard.',
    'Return ONLY a JSON object, no prose: {"words":["w1","w2","w3"]}',
    'Exactly 3 single words, most likely first, lowercase unless a proper noun or "I".',
    prefix ? `The text ends mid-word: every word MUST start with "${prefix}" and complete it.` : 'The text ends after a space: give the 3 most likely NEXT words.',
    `Text so far: "${text.slice(-160)}"`,
  ].join('\n')
}

/** Strict parse of {"words":[...]} (or a bare array). Single tokens only, deduped, must match the typed prefix. */
export function parsePredictions(raw: string, text = ''): string[] {
  const j = extractJson(raw)
  const arr = Array.isArray(j) ? j : j && typeof j === 'object' ? (j as { words?: unknown }).words : null
  if (!Array.isArray(arr)) return []
  const { prefix } = splitContext(text)
  const out: string[] = []
  for (const x of arr) {
    if (typeof x !== 'string') continue
    const w = x.trim()
    if (!/^[A-Za-z][A-Za-z'’-]{0,29}$/.test(w)) continue
    if (prefix && !w.toLowerCase().startsWith(prefix.toLowerCase())) continue
    if (!out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w)
    if (out.length === 3) break
  }
  return out
}

/** Model words first, topped up from the offline list so there are always 3 (unless the offline list has none). */
export async function predictWords(text: string, opts: { client?: ChatClient; model?: string; offlineOnly?: boolean } = {}): Promise<PredictResult> {
  const offline = offlinePredict(text, 3)
  if (opts.offlineOnly || !opts.client) return { words: offline, source: 'offline', latencyMs: 0 }
  const t0 = performance.now()
  try {
    const r = await fastJson(opts.client, buildPredictPrompt(text), 60, opts.model ?? fastModel())
    const words = parsePredictions(r.raw, text)
    if (words.length === 0) return { words: offline, source: 'offline', latencyMs: r.latencyMs }
    for (const w of offline) if (words.length < 3 && !words.some((x) => x.toLowerCase() === w.toLowerCase())) words.push(w)
    return { words: words.slice(0, 3), source: 'model', latencyMs: r.latencyMs }
  } catch {
    return { words: offline, source: 'offline', latencyMs: Math.round(performance.now() - t0) }
  }
}

export { offlinePredict, splitContext, wordInsertion, WORDS } from './offline'
