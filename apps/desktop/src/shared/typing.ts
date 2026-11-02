// IPC types for Typing mode ("type with your eyes"). Merged into InvokeMap / EventMap in ipc.ts.

export type TypingSource = 'suggestion' | 'key' | 'word'
export type TypingMode = 'replies' | 'keys'

export interface TypingStatsMsg {
  /** Characters produced in the focused app (gross, backspace not subtracted). */
  chars: number
  /** Characters on screen now (chars minus backspaces). */
  netChars: number
  /** Deliberate selections the user made (one dwell or one wink = one keystroke). */
  keystrokes: number
  charsPerKeystroke: number
  /** Words per minute, 5 chars = 1 word, from panel open (or last reset) to the last selection. */
  wpm: number
  /** Same, but only for the gaze keyboard (letters + predicted words), from its first to its last selection. */
  keyboardWpm: number
  elapsedMs: number
  bySource: Record<TypingSource, { chars: number; keystrokes: number }>
  /** Latency of the last suggestion call, ms. */
  lastSuggestMs: number | null
  suggestModel: string
}

export interface SuggestContextInfo {
  kind: 'browse' | 'desktop'
  app: string
  lookingAt?: string
  selected?: string
}

export interface SuggestResult {
  items: string[]
  latencyMs: number
  model: string
  source: 'model' | 'offline'
  error?: string
  context: SuggestContextInfo
}

export interface PredictResult {
  words: string[]
  source: 'model' | 'offline'
  latencyMs: number
}

export interface TypingInvoke {
  'typing:open': [void, void]
  'typing:close': [void, void]
  'typing:suggest': [void, SuggestResult]
  'typing:predict': [{ text: string }, PredictResult]
  'typing:type': [{ text: string; source: TypingSource }, { ok: boolean; error?: string }]
  'typing:key': [{ key: string; modifiers?: string[]; source?: TypingSource }, { ok: boolean; error?: string }]
  'typing:stats': [void, TypingStatsMsg]
  'typing:reset': [void, void]
  'typing:mode': [{ mode: TypingMode }, void]
}

export interface TypingEvents {
  /** Gaze in typing-window coordinates (null = no gaze). */
  'typing:gaze': { x: number; y: number } | null
  /** Left wink while Typing is open: select what the gaze is on. */
  'typing:wink': void
  'typing:stats': TypingStatsMsg
  'typing:opened': void
}
