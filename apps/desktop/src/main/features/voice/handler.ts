// The main-process side of the voice path: recording state, gaze capture, transcription, toasts, intent.
// All side effects come in through `deps`, so the whole flow runs under vitest with mocks.
import { VOICE_LIMITS, type SpeechReply, type VoiceClientCode, type VoiceCode, type VoiceResult } from '../../../shared/voice'
import { pickGaze, type GazePick, type GazeSample, type Pt } from './gaze'

export interface SpeechRequest {
  audio: ArrayBuffer
  mime: string
  /** Recorder start to stop press, measured by the renderer. */
  durationMs?: number
  /** Date.now() at the moment the user asked to stop (same clock as the gaze history). */
  stopAt?: number
}

export interface VoiceDeps {
  toast: (text: string, sub?: string, ms?: number) => void
  gazeSamples: () => readonly GazeSample[]
  latestGaze: () => Pt | null
  transcribe: (audio: ArrayBuffer, mime: string, o: { durationMs?: number }) => Promise<SpeechReply>
  runIntent: (command: string, source: 'voice', gaze: Pt | null) => unknown
  emit: (r: VoiceResult) => void
  now?: () => number
}

/** Title and hint for the overlay toast, per failure. */
export const FAILURE_TOASTS: Record<VoiceCode, [string, string]> = {
  'no-key': ['Speech needs an OpenAI key', 'Set OPENAI_API_KEY or type the command'],
  'too-short': ['Too short', 'Press Option+Space, say the command, press it again'],
  'too-long': ['Too long for a command', 'Say it in one sentence'],
  silence: ['Did not catch that', 'No speech heard: check the microphone'],
  empty: ['Did not catch that', 'No speech heard: try again'],
  auth: ['OpenAI key rejected', 'Check OPENAI_API_KEY, or type the command'],
  rate: ['Speech service is busy', 'Try again in a moment, or type the command'],
  network: ['Speech service unreachable', 'Check the connection, or type the command'],
  failed: ['Speech failed', 'Try again or type the command'],
  'mic-denied': ['Microphone is off for Glance', 'System Settings > Privacy & Security > Microphone'],
  'mic-error': ['Microphone error', 'Check that a microphone is connected'],
}

export function createVoice(deps: VoiceDeps) {
  const now = deps.now ?? Date.now
  let startGaze: Pt | null = null
  let startNotedAt = 0

  const gazeFor = (stopAt: number): GazePick | null => pickGaze(deps.gazeSamples(), stopAt, { windowMs: VOICE_LIMITS.gazeWindowMs, startGaze, latest: deps.latestGaze() })

  const result = (r: Partial<VoiceResult> & Pick<VoiceResult, 'raw' | 'command'>, g: GazePick | null): VoiceResult => ({
    ts: now(),
    sttMs: 0,
    gaze: g ? { x: g.point.x, y: g.point.y, source: g.source, samples: g.samples } : null,
    ...r,
  })

  function pressStart(): void {
    startGaze = deps.latestGaze()
    startNotedAt = now()
  }

  return {
    /** The user pressed the talk key (main process, before the recorder spins up): remember the gaze as the fallback. */
    pressStart,

    /** The renderer started or stopped the recorder. A start without an earlier key press (button, radial) notes the gaze now. */
    onRecording(recording: boolean): void {
      if (recording && now() - startNotedAt > 3000) pressStart()
    },

    /** The renderer detected a problem before any audio existed (mic denied, silence, bounce). */
    clientError(code: VoiceClientCode, detail?: string): void {
      const [t, s] = FAILURE_TOASTS[code]
      deps.toast(t, s, 3200)
      deps.emit(result({ raw: '', command: '', code, error: detail ?? t }, null))
    },

    /** Audio in, intent out. Never throws. */
    async handle(req: SpeechRequest): Promise<SpeechReply> {
      const stopAt = req.stopAt && Math.abs(now() - req.stopAt) < 30_000 ? req.stopAt : now()
      const gaze = gazeFor(stopAt) // captured before the network round trip: the user keeps looking around
      deps.toast('Transcribing…', 'Listening is done', 15_000)
      let t: SpeechReply
      try {
        t = await deps.transcribe(req.audio, req.mime, { durationMs: req.durationMs })
      } catch (e) {
        t = { text: '', code: 'failed', error: e instanceof Error ? e.message.slice(0, 120) : 'Speech failed' }
      }
      if (t.error || !t.text) {
        const code: VoiceCode = t.code ?? (t.error ? 'failed' : 'empty')
        const [title, sub] = FAILURE_TOASTS[code]
        deps.toast(title, sub, 3200)
        deps.emit(result({ raw: t.raw ?? '', command: '', sttMs: t.latencyMs ?? 0, code, error: t.error ?? title }, gaze))
        return { ...t, code }
      }
      deps.toast(`“${t.text}”`, `Heard${t.latencyMs ? ` · ${t.latencyMs} ms` : ''}`, 2200)
      deps.emit(result({ raw: t.raw ?? t.text, command: t.text, sttMs: t.latencyMs ?? 0 }, gaze))
      Promise.resolve(deps.runIntent(t.text, 'voice', gaze ? gaze.point : null)).catch((e: unknown) => deps.toast('Could not run the command', e instanceof Error ? e.message.slice(0, 90) : 'unknown error'))
      return t
    },
  }
}

export type Voice = ReturnType<typeof createVoice>
