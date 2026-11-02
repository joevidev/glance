// Pure checks on a finished recording, before anything is uploaded.
import { VOICE_LIMITS, type VoiceClientCode } from '../../../shared/voice'

export interface ClipFacts {
  durationMs: number
  bytes: number
  /** Peak of the 50 ms RMS over the recording, 0..1. null = the level meter could not run (do not gate on it). */
  peak: number | null
}

/** null = fine to send. Otherwise the reason it must not reach the speech model. */
export function judgeClip(c: ClipFacts): VoiceClientCode | null {
  if (c.durationMs < VOICE_LIMITS.minDurationMs || c.bytes < VOICE_LIMITS.minBytes) return 'too-short'
  if (c.peak !== null && c.peak < VOICE_LIMITS.silencePeakRms) return 'silence'
  return null
}

export function rms(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!
  return Math.sqrt(s / Math.max(1, buf.length))
}

export const CLIENT_MESSAGES: Record<VoiceClientCode, string> = {
  'too-short': 'Too short: press Option+Space, say the command, press it again.',
  silence: 'No sound heard. Check the microphone input level and try again.',
  'mic-denied': 'Microphone access is off for Glance. Turn it on in System Settings > Privacy & Security > Microphone, then restart Glance.',
  'mic-error': 'The microphone could not start. Check that one is connected and not used by another app.',
}
