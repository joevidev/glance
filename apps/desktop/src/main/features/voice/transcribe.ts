// Speech to text core: validation, one explicit retry, error mapping, normalization. No electron import: it runs
// in the main process and under vitest/node with a mocked client.
import OpenAI, { toFile } from 'openai'
import { VOICE_LIMITS, type SpeechReply, type VoiceCode } from '../../../shared/voice'
import { isNonCommand, normalizeCommand } from './normalize'

export const STT_MODEL = 'gpt-4o-mini-transcribe'
export const STT_PROMPT = 'A short spoken command to control a computer, for example: open that, click this one, go to pricing.'
const PROMPT_EXAMPLES = ['open that', 'click this one', 'go to pricing']
const TIMEOUT_MS = 8_000
const RETRY_DELAY_MS = 350

export interface SttClient {
  audio: {
    transcriptions: {
      create(body: { file: unknown; model: string; language: string; prompt: string }, opts?: { timeout?: number; maxRetries?: number }): Promise<{ text?: string }>
    }
  }
}

export interface SttOptions {
  /** Recording length, measured by the renderer from recorder start to stop press. */
  durationMs?: number
  apiKey?: string | undefined
  makeClient?: (key: string) => SttClient
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** Remove anything that looks like an API key from a message before it reaches a toast, a log or a renderer. */
export function scrub(msg: string): string {
  return msg.replace(/sk-[A-Za-z0-9_*.\-]{4,}/g, '[key]').replace(/Bearer\s+\S+/gi, 'Bearer [key]').replace(/\s+/g, ' ').trim().slice(0, 160)
}

export function extFor(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('wav')) return 'wav'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  return 'webm'
}

interface Classified {
  code: VoiceCode
  message: string
  retry: boolean
}

export function classify(e: unknown): Classified {
  const status = typeof (e as { status?: unknown })?.status === 'number' ? ((e as { status: number }).status as number) : undefined
  const raw = e instanceof Error ? e.message : String(e)
  if (status === 401 || status === 403) return { code: 'auth', message: 'OpenAI key rejected: check OPENAI_API_KEY', retry: false }
  if (status === 429) return { code: 'rate', message: 'Speech service is busy (rate limit)', retry: true }
  if (status !== undefined && status >= 500) return { code: 'network', message: `Speech service error (${status})`, retry: true }
  if (status !== undefined) return { code: 'failed', message: `Audio rejected (${status}): ${scrub(raw)}`, retry: false }
  return { code: 'network', message: /timed? ?out/i.test(raw) ? 'Speech service timed out' : 'Speech service unreachable', retry: true }
}

export async function transcribeAudio(audio: ArrayBuffer, mime: string, o: SttOptions = {}): Promise<SpeechReply> {
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const t0 = now()
  const fail = (code: VoiceCode, error: string, raw = ''): SpeechReply => ({ text: '', raw, error, code, latencyMs: now() - t0 })

  const key = o.apiKey ?? process.env.OPENAI_API_KEY
  if (!key) return fail('no-key', 'OPENAI_API_KEY is not set: type the command instead.')
  if (o.durationMs !== undefined && o.durationMs < VOICE_LIMITS.minDurationMs) return fail('too-short', 'Too short: keep talking until you press stop')
  if (audio.byteLength < VOICE_LIMITS.minBytes) return fail('too-short', 'Too short: no speech in the recording')
  if ((o.durationMs ?? 0) > VOICE_LIMITS.hardMaxDurationMs || audio.byteLength > VOICE_LIMITS.maxBytes) return fail('too-long', 'Too long for a command: say it in a sentence')

  let client: SttClient
  try {
    client = (o.makeClient ?? ((k) => new OpenAI({ apiKey: k, timeout: TIMEOUT_MS, maxRetries: 0 }) as unknown as SttClient))(key)
  } catch (e) {
    return fail('failed', scrub(e instanceof Error ? e.message : String(e)))
  }

  const call = async () => {
    const file = await toFile(Buffer.from(audio), `command.${extFor(mime)}`, { type: mime })
    return client.audio.transcriptions.create({ file, model: STT_MODEL, language: 'en', prompt: STT_PROMPT }, { timeout: TIMEOUT_MS, maxRetries: 0 })
  }

  let last: Classified | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await call()
      const raw = (r.text ?? '').trim()
      if (isNonCommand(raw, PROMPT_EXAMPLES)) return fail(raw ? 'silence' : 'empty', 'Did not catch that: no speech heard', raw)
      return { text: normalizeCommand(raw), raw, latencyMs: now() - t0 }
    } catch (e) {
      last = classify(e)
      if (!last.retry || attempt === 1) break
      await sleep(RETRY_DELAY_MS)
    }
  }
  return fail(last!.code, last!.message)
}
