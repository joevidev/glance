import { describe, expect, it, vi } from 'vitest'
import { classify, extFor, scrub, transcribeAudio, type SttClient } from './transcribe'

const audio = (n = 6000) => new ArrayBuffer(n)
const MIME = 'audio/webm;codecs=opus'
const noSleep = async () => {}
const clientOf = (create: (...a: never[]) => Promise<{ text?: string }>): ((k: string) => SttClient) => () => ({ audio: { transcriptions: { create: create as never } } })
const httpError = (status: number, message = 'x') => Object.assign(new Error(message), { status })

describe('transcribeAudio', () => {
  it('happy path: normalizes, reports raw and latency, sends a .webm file name', async () => {
    const create = vi.fn(async (body: { file: { name: string; type: string } }) => {
      expect(body.file.name).toBe('command.webm')
      expect(body.file.type).toBe(MIME)
      return { text: 'Um, open that, please.' }
    })
    const r = await transcribeAudio(audio(), MIME, { apiKey: 'k', makeClient: clientOf(create as never), sleep: noSleep })
    expect(r).toMatchObject({ text: 'open that', raw: 'Um, open that, please.' })
    expect(r.error).toBeUndefined()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('no key: no client is built, clear error', async () => {
    const makeClient = vi.fn()
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const r = await transcribeAudio(audio(), MIME, { makeClient })
      expect(r.code).toBe('no-key')
      expect(r.error).toMatch(/OPENAI_API_KEY/)
      expect(makeClient).not.toHaveBeenCalled()
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev
    }
  })

  it('too short (bytes or duration) and too long never call the model', async () => {
    const create = vi.fn()
    const o = { apiKey: 'k', makeClient: clientOf(create as never) }
    expect((await transcribeAudio(audio(300), MIME, o)).code).toBe('too-short')
    expect((await transcribeAudio(audio(0), MIME, o)).code).toBe('too-short')
    expect((await transcribeAudio(audio(), MIME, { ...o, durationMs: 120 })).code).toBe('too-short')
    expect((await transcribeAudio(audio(), MIME, { ...o, durationMs: 45_000 })).code).toBe('too-long')
    expect((await transcribeAudio(audio(5_000_000), MIME, o)).code).toBe('too-long')
    expect(create).not.toHaveBeenCalled()
  })

  it('silence: empty text, a hallucination or the echoed prompt all become "did not catch that", never a command', async () => {
    for (const text of ['', '  ', 'Thank you.', 'A short spoken command to control a computer, for example: open that, click this one, go to pricing.']) {
      const r = await transcribeAudio(audio(), MIME, { apiKey: 'k', makeClient: clientOf(async () => ({ text })), sleep: noSleep })
      expect(r.text).toBe('')
      expect(['empty', 'silence']).toContain(r.code)
    }
  })

  it('retries once on a timeout, then succeeds', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('Request timed out.')).mockResolvedValueOnce({ text: 'scroll down' })
    const r = await transcribeAudio(audio(), MIME, { apiKey: 'k', makeClient: clientOf(create as never), sleep: noSleep })
    expect(r.text).toBe('scroll down')
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('retries once on 429 and 500, then reports; at most two calls', async () => {
    for (const [status, code] of [[429, 'rate'], [503, 'network']] as const) {
      const create = vi.fn().mockRejectedValue(httpError(status))
      const r = await transcribeAudio(audio(), MIME, { apiKey: 'k', makeClient: clientOf(create as never), sleep: noSleep })
      expect(r.code).toBe(code)
      expect(create).toHaveBeenCalledTimes(2)
    }
  })

  it('does not retry 401 or 400, and never leaks the key', async () => {
    const leak = 'Incorrect API key provided: sk-proj-abcdEFGH1234***wxyz. You can find your API key at https://platform.openai.com'
    const c401 = vi.fn().mockRejectedValue(httpError(401, leak))
    const r1 = await transcribeAudio(audio(), MIME, { apiKey: 'k', makeClient: clientOf(c401 as never), sleep: noSleep })
    expect(r1.code).toBe('auth')
    expect(r1.error).not.toMatch(/sk-/)
    expect(c401).toHaveBeenCalledTimes(1)
    const c400 = vi.fn().mockRejectedValue(httpError(400, 'Invalid file format. key sk-proj-abcdEFGH1234'))
    const r2 = await transcribeAudio(audio(), MIME, { apiKey: 'k', makeClient: clientOf(c400 as never), sleep: noSleep })
    expect(r2.code).toBe('failed')
    expect(r2.error).not.toMatch(/sk-proj/)
    expect(c400).toHaveBeenCalledTimes(1)
  })

  it('network failure (no status) is retried and reported as unreachable', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Connection error.'))
    const r = await transcribeAudio(audio(), MIME, { apiKey: 'k', makeClient: clientOf(create as never), sleep: noSleep })
    expect(r.code).toBe('network')
    expect(create).toHaveBeenCalledTimes(2)
  })
})

describe('helpers', () => {
  it('extFor maps the recorder mime to a file extension the endpoint accepts', () => {
    expect(extFor('audio/webm;codecs=opus')).toBe('webm')
    expect(extFor('audio/webm')).toBe('webm')
    expect(extFor('audio/mp4')).toBe('m4a')
    expect(extFor('audio/ogg;codecs=opus')).toBe('ogg')
  })
  it('scrub removes keys and bearer tokens', () => {
    expect(scrub('bad sk-proj-abcdEFGH1234 and Bearer abc.def')).toBe('bad [key] and Bearer [key]')
  })
  it('classify', () => {
    expect(classify(httpError(401)).code).toBe('auth')
    expect(classify(new Error('timeout')).retry).toBe(true)
  })
})
