// Typing counters for the pitch: characters typed vs keystrokes the user made, and words per minute (5 chars = 1 word).
import type { TypingSource, TypingStatsMsg } from '../../../shared/typing'

type Src = { chars: number; keystrokes: number; firstAt: number; lastAt: number; net: number }
const blank = (): Src => ({ chars: 0, keystrokes: 0, firstAt: 0, lastAt: 0, net: 0 })

export class TypingStats {
  private startedAt: number
  private lastAt = 0
  private src: Record<TypingSource, Src> = { suggestion: blank(), key: blank(), word: blank() }
  lastSuggestMs: number | null = null
  suggestModel = ''

  constructor(private now: () => number = Date.now) {
    this.startedAt = now()
  }

  reset(): void {
    this.startedAt = this.now()
    this.lastAt = 0
    this.src = { suggestion: blank(), key: blank(), word: blank() }
  }

  /** One deliberate selection that produced `chars` characters (negative net for backspace: pass netDelta). */
  record(source: TypingSource, chars: number, netDelta = chars): void {
    const t = this.now()
    const s = this.src[source]
    if (!s.firstAt) s.firstAt = t
    s.lastAt = t
    s.chars += Math.max(0, chars)
    s.net += netDelta
    s.keystrokes += 1
    this.lastAt = t
  }

  snapshot(): TypingStatsMsg {
    const all = Object.values(this.src)
    const chars = all.reduce((a, s) => a + s.chars, 0)
    const net = all.reduce((a, s) => a + s.net, 0)
    const keys = all.reduce((a, s) => a + s.keystrokes, 0)
    const elapsed = this.lastAt ? this.lastAt - this.startedAt : 0
    const wpmOf = (words: number, ms: number) => (ms > 0 && words > 0 ? Math.round((words / (ms / 60000)) * 10) / 10 : 0)
    // gaze keyboard: letters + predicted words, from its first to its last selection (min 1 s so one key is not 5000 wpm)
    const kbNet = this.src.key.net + this.src.word.net
    const kbFirst = Math.min(...[this.src.key.firstAt, this.src.word.firstAt].filter(Boolean))
    const kbLast = Math.max(this.src.key.lastAt, this.src.word.lastAt)
    const kbMs = Number.isFinite(kbFirst) && kbLast ? Math.max(1000, kbLast - kbFirst) : 0
    return {
      chars,
      netChars: net,
      keystrokes: keys,
      charsPerKeystroke: keys ? Math.round((chars / keys) * 100) / 100 : 0,
      wpm: wpmOf(Math.max(0, net) / 5, Math.max(1000, elapsed)),
      keyboardWpm: wpmOf(Math.max(0, kbNet) / 5, kbMs),
      elapsedMs: elapsed,
      bySource: {
        suggestion: { chars: this.src.suggestion.chars, keystrokes: this.src.suggestion.keystrokes },
        key: { chars: this.src.key.chars, keystrokes: this.src.key.keystrokes },
        word: { chars: this.src.word.chars, keystrokes: this.src.word.keystrokes },
      },
      lastSuggestMs: this.lastSuggestMs,
      suggestModel: this.suggestModel,
    }
  }
}
