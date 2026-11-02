// Voice path: limits and types shared by main and renderer. Pure, no imports.

export const VOICE_LIMITS = {
  /** Shorter than this (recorder start to stop) is a bounce or an accidental key press: no upload. */
  minDurationMs: 400,
  /** The renderer stops the recording by itself here. */
  maxDurationMs: 15_000,
  /** Main refuses anything longer than this (a hung recorder), no upload. */
  hardMaxDurationMs: 30_000,
  /** An opus/webm clip smaller than this holds no speech (the container header alone is a few hundred bytes). */
  minBytes: 1_200,
  /** 15 s of opus is about 60 KB; anything past this is not a voice command. */
  maxBytes: 4_000_000,
  /** Peak of the 50 ms RMS over the whole recording, 0..1 full scale. Below it the room was silent: no upload. (-44 dBFS) */
  silencePeakRms: 0.006,
  /** Ignore a second toggle this soon after the first (key repeat while Option+Space is held, double taps). */
  toggleDebounceMs: 250,
  /** Gaze window before the stop press. */
  gazeWindowMs: 400,
} as const

/** Why a voice command did not become an intent. */
export type VoiceCode =
  | 'no-key'
  | 'too-short'
  | 'too-long'
  | 'silence'
  | 'empty'
  | 'auth'
  | 'rate'
  | 'network'
  | 'failed'
  | 'mic-denied'
  | 'mic-error'

/** Failures the renderer detects before any audio is sent. */
export type VoiceClientCode = 'too-short' | 'silence' | 'mic-denied' | 'mic-error'

export interface SpeechReply {
  /** Normalized command text ('' when nothing usable). */
  text: string
  /** What the model heard, untouched. */
  raw?: string
  error?: string
  code?: VoiceCode
  latencyMs?: number
}

export interface VoiceResult {
  ts: number
  raw: string
  /** Normalized text sent to the intent call ('' on failure). */
  command: string
  sttMs: number
  code?: VoiceCode
  error?: string
  /** Where the gaze point came from: median of the last 400 ms before stop, the point at speech start, or the latest one. */
  gaze: { x: number; y: number; source: 'stop-median' | 'start' | 'latest'; samples: number } | null
}
