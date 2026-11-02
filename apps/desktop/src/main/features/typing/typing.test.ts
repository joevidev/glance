import { describe, expect, it } from 'vitest'
import type { ChatClient } from '@glance/brain'
import { buildPredictPrompt, offlinePredict, parsePredictions, predictWords, splitContext, wordInsertion } from './predict'
import { buildSuggestPrompt, FALLBACK_REPLIES, parseSuggestions, suggestReplies } from './suggest'
import { fastJson } from './model'
import { TypingStats } from './stats'

function mock(replies: (string | Error)[], seen: Record<string, unknown>[] = []): ChatClient {
  let i = 0
  return {
    chat: {
      completions: {
        create: async (p) => {
          seen.push(p)
          const r = replies[Math.min(i++, replies.length - 1)]!
          if (r instanceof Error) throw r
          return { choices: [{ message: { content: r } }] }
        },
      },
    },
  }
}

describe('parseSuggestions', () => {
  it('parses strict JSON', () => {
    expect(parseSuggestions('{"replies":["Yes, Friday works.","Can we do 4pm?","Sorry, I am busy."]}')).toEqual(['Yes, Friday works.', 'Can we do 4pm?', 'Sorry, I am busy.'])
  })
  it('tolerates code fences, prose, bare arrays and alt keys', () => {
    expect(parseSuggestions('```json\n{"replies":["a","b","c"]}\n```')).toEqual(['a', 'b', 'c'])
    expect(parseSuggestions('Sure! {"suggestions":["a","b"]} hope it helps')).toEqual(['a', 'b'])
    expect(parseSuggestions('["x","y","z","w"]')).toEqual(['x', 'y', 'z'])
  })
  it('cleans, dedupes, drops non-strings, never throws', () => {
    expect(parseSuggestions('{"replies":["  Hi   there ","hi there",5,null,"",{"text":"Obj"}]}')).toEqual(['Hi there', 'Obj'])
    for (const bad of ['', 'nope', '{', '{"replies":"x"}', '{"replies":{}}', 'null', '[1,2]']) expect(parseSuggestions(bad)).toEqual([])
  })
})

describe('suggestReplies (mocked client)', () => {
  it('returns three model replies and sends a JSON-mode request with the context', async () => {
    const seen: Record<string, unknown>[] = []
    const c = mock(['{"replies":["Yes, 3pm works.","Could we do 4pm?","Sorry, I cannot Friday."]}'], seen)
    const r = await suggestReplies({ kind: 'browse', app: 'Glance Browse', lookingAt: 'Re: Friday 3pm?', pageText: 'Can we meet Friday at 3pm?' }, { client: c, model: 'gpt-5.4-mini' })
    expect(r.source).toBe('model')
    expect(r.items).toHaveLength(3)
    const p = seen[0]!
    expect(p.model).toBe('gpt-5.4-mini')
    expect(p.max_completion_tokens).toBe(220)
    expect(p.response_format).toEqual({ type: 'json_object' })
    expect(p.reasoning_effort).toBe('none')
    expect(p.temperature).toBeUndefined()
    expect(String((p.messages as { content: string }[])[0]!.content)).toContain('Friday at 3pm')
  })
  it('pads to three with offline replies when the model gives fewer', async () => {
    const r = await suggestReplies({ kind: 'desktop', app: 'Notes' }, { client: mock(['{"replies":["Only one."]}']) })
    expect(r.items).toHaveLength(3)
    expect(r.items[0]).toBe('Only one.')
    expect(r.source).toBe('model')
  })
  it('falls back offline (never throws) on garbage or an API error', async () => {
    const a = await suggestReplies({ kind: 'desktop', app: 'X' }, { client: mock(['lol no json']) })
    expect(a.source).toBe('offline')
    expect(a.items).toEqual(FALLBACK_REPLIES)
    const b = await suggestReplies({ kind: 'desktop', app: 'X' }, { client: mock([new Error('network down')]) })
    expect(b.source).toBe('offline')
    expect(b.error).toContain('network down')
    expect(b.items).toHaveLength(3)
  })
  it('prompt carries app, looked-at element, selection and page text', () => {
    const p = buildSuggestPrompt({ kind: 'desktop', app: 'Messages', selected: 'dinner at 8?', lookingAt: 'Send button' })
    expect(p).toContain('Messages')
    expect(p).toContain('dinner at 8?')
    expect(p).toContain('Send button')
    expect(p).toContain('"replies"')
  })
})

describe('fastJson parameter fallback', () => {
  it('retries without extras when the model rejects a parameter', async () => {
    const seen: Record<string, unknown>[] = []
    const c = mock([new Error('400 Unrecognized request argument supplied: reasoning_effort'), '{"ok":1}'], seen)
    const r = await fastJson(c, 'hi', 50, 'gpt-5.4-mini')
    expect(r.raw).toBe('{"ok":1}')
    expect(seen).toHaveLength(2)
    expect(seen[1]!.reasoning_effort).toBeUndefined()
    expect(seen[1]!.response_format).toBeUndefined()
  })
  it('does not send reasoning_effort to non gpt-5 models', async () => {
    const seen: Record<string, unknown>[] = []
    await fastJson(mock(['{}'], seen), 'hi', 50, 'gpt-4.1-mini')
    expect(seen[0]!.reasoning_effort).toBeUndefined()
  })
})

describe('offline prediction', () => {
  it('completes a prefix from the frequency list, most frequent first', () => {
    const w = offlinePredict('see you to')
    expect(w.length).toBeGreaterThan(0)
    for (const x of w) expect(x.toLowerCase().startsWith('to')).toBe(true)
    expect(offlinePredict('th')[0]).toBe('the')
  })
  it('uses bigrams after a space and always returns something', () => {
    expect(offlinePredict('thank ')[0]).toBe('you')
    expect(offlinePredict('')).toHaveLength(3)
    expect(offlinePredict('zzqx')).toEqual(['zzqx'])
  })
  it('splits context', () => {
    expect(splitContext('hello wor')).toEqual({ prefix: 'wor', prev: 'hello', prev2: '' })
    expect(splitContext('i am ')).toEqual({ prefix: '', prev: 'am', prev2: 'i' })
  })
  it('word insertion types only the missing letters, then a space', () => {
    expect(wordInsertion('hello wor', 'world')).toBe('ld ')
    expect(wordInsertion('hello ', 'world')).toBe('world ')
    expect(wordInsertion('He', 'hello')).toBe('llo ')
  })
})

describe('model prediction (mocked client)', () => {
  it('parses words and enforces the typed prefix', () => {
    expect(parsePredictions('{"words":["world","work","hello","wor d"]}', 'hello wor')).toEqual(['world', 'work'])
    expect(parsePredictions('{"words":["the","and","you"]}', 'abc ')).toEqual(['the', 'and', 'you'])
    expect(parsePredictions('garbage', 'a')).toEqual([])
    expect(buildPredictPrompt('hello wor')).toContain('"wor"')
  })
  it('uses model words, tops up offline, and falls back when offline or failing', async () => {
    const m = await predictWords('i am ', { client: mock(['{"words":["happy","going"]}']) })
    expect(m.source).toBe('model')
    expect(m.words.slice(0, 2)).toEqual(['happy', 'going'])
    expect(m.words).toHaveLength(3)
    const f = await predictWords('th', { client: mock([new Error('boom')]) })
    expect(f.source).toBe('offline')
    expect(f.words[0]).toBe('the')
    const o = await predictWords('th', { offlineOnly: true })
    expect(o.words[0]).toBe('the')
  })
})

describe('TypingStats', () => {
  it('counts chars vs keystrokes and wpm (5 chars = 1 word)', () => {
    let t = 1000
    const s = new TypingStats(() => t)
    s.reset()
    t = 7000
    s.record('suggestion', 60) // one selection, 60 chars, 6 s after open
    let x = s.snapshot()
    expect(x.chars).toBe(60)
    expect(x.keystrokes).toBe(1)
    expect(x.charsPerKeystroke).toBe(60)
    expect(x.wpm).toBe(120) // 12 words in 0.1 min
    t = 8000
    s.record('key', 1)
    s.record('key', 0, -1) // backspace
    x = s.snapshot()
    expect(x.keystrokes).toBe(3)
    expect(x.chars).toBe(61)
    expect(x.netChars).toBe(60)
    expect(x.bySource.key).toEqual({ chars: 1, keystrokes: 2 })
  })
  it('is zero before anything is typed', () => {
    const x = new TypingStats(() => 5).snapshot()
    expect([x.chars, x.keystrokes, x.wpm, x.keyboardWpm]).toEqual([0, 0, 0, 0])
  })
})
