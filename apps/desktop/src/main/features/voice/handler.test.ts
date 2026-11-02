import { describe, expect, it, vi } from 'vitest'
import { createVoice, type VoiceDeps } from './handler'
import type { SpeechReply, VoiceResult } from '../../../shared/voice'

function setup(reply: SpeechReply, samples: { ts: number; p: { x: number; y: number } }[] = []) {
  const toasts: string[] = []
  const emitted: VoiceResult[] = []
  const runIntent = vi.fn()
  const transcribe = vi.fn(async () => reply)
  const deps: VoiceDeps = {
    toast: (t) => toasts.push(t),
    gazeSamples: () => samples,
    latestGaze: () => ({ x: 5, y: 5 }),
    transcribe,
    runIntent,
    emit: (r) => emitted.push(r),
    now: () => 10_000,
  }
  return { voice: createVoice(deps), toasts, emitted, runIntent, transcribe }
}
const req = { audio: new ArrayBuffer(4000), mime: 'audio/webm;codecs=opus', durationMs: 1500, stopAt: 10_000 }
const lookAt = (x: number, y: number) => Array.from({ length: 10 }, (_, i) => ({ ts: 9650 + i * 35, p: { x, y } }))

describe('voice handler', () => {
  it('transcript -> intent with the median gaze at stop, even if the latest gaze moved', async () => {
    const { voice, runIntent, emitted, toasts } = setup({ text: 'open that', raw: 'Open that.', latencyMs: 410 }, lookAt(800, 400))
    const r = await voice.handle(req)
    expect(r.text).toBe('open that')
    expect(runIntent).toHaveBeenCalledWith('open that', 'voice', { x: 800, y: 400 })
    expect(toasts[0]).toBe('Transcribing…')
    expect(toasts.at(-1)).toBe('“open that”')
    expect(emitted[0]).toMatchObject({ raw: 'Open that.', command: 'open that', sttMs: 410, gaze: { source: 'stop-median' } })
  })

  it('silence / transcription error: clear toast, NO intent call, debug event carries the reason', async () => {
    for (const code of ['silence', 'empty', 'auth', 'network', 'no-key', 'too-short'] as const) {
      const { voice, runIntent, toasts, emitted } = setup({ text: '', code, error: 'x' })
      await voice.handle(req)
      expect(runIntent).not.toHaveBeenCalled()
      expect(toasts.at(-1)).not.toBe('Transcribing…')
      expect(emitted[0]).toMatchObject({ command: '', code })
    }
  })

  it('a transcribe function that throws still ends in a toast and no intent', async () => {
    const t = setup({ text: '' })
    t.transcribe.mockRejectedValueOnce(new Error('boom'))
    const r = await t.voice.handle(req)
    expect(r.code).toBe('failed')
    expect(t.runIntent).not.toHaveBeenCalled()
    expect(t.toasts.at(-1)).toBe('Speech failed')
  })

  it('falls back to the gaze at speech start when no samples exist near stop', async () => {
    const { voice, runIntent } = setup({ text: 'open that', raw: 'open that' }, [])
    voice.pressStart() // latestGaze = 5,5 at the press
    await voice.handle(req)
    expect(runIntent).toHaveBeenCalledWith('open that', 'voice', { x: 5, y: 5 })
  })

  it('client-side failures (mic denied, silence) toast and emit without any model call', () => {
    const { voice, toasts, emitted, transcribe, runIntent } = setup({ text: '' })
    voice.clientError('mic-denied')
    voice.clientError('silence')
    expect(toasts).toEqual(['Microphone is off for Glance', 'Did not catch that'])
    expect(emitted.map((e) => e.code)).toEqual(['mic-denied', 'silence'])
    expect(transcribe).not.toHaveBeenCalled()
    expect(runIntent).not.toHaveBeenCalled()
  })
})
