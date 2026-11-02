// Command text normalization: trim, lowercase, drop fillers and edge punctuation. Never changes the meaning:
// words like "that", "this", "yes", "like", "the" are kept; only disfluencies and "please" go.

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'err', 'hmm', 'hm', 'mm', 'mmm', 'please'])

/** What the speech model says when it hears silence or noise. None of these is a command. */
const SILENCE_HALLUCINATIONS = new Set([
  'you',
  'thank you',
  'thanks',
  'thank you for watching',
  'thanks for watching',
  'bye',
  'bye bye',
  'okay',
  'ok',
  'the end',
])

export function normalizeCommand(input: string): string {
  const tokens = input
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, ' ')
    .split(/\s+/)
    .map((t) => t.toLowerCase().replace(/^[^a-z0-9#$@']+|[^a-z0-9%']+$/g, '').replace(/^'+|'+$/g, ''))
    .filter((t) => t.length > 0 && !FILLERS.has(t))
  return tokens.join(' ')
}

/**
 * True when the text is not a real command: empty after normalization, a classic silence hallucination, or the
 * transcription prompt echoed back (the model does that on silence).
 */
export function isNonCommand(raw: string, promptExamples: readonly string[] = []): boolean {
  const n = normalizeCommand(raw)
  if (!n) return true
  if (SILENCE_HALLUCINATIONS.has(n)) return true
  const joined = normalizeCommand(promptExamples.join(' '))
  // only a (near) whole echo counts: a real "go to pricing" is a substring of the prompt and must pass
  if (joined && (n.includes(joined) || (joined.includes(n) && n.length >= joined.length * 0.6))) return true
  return false
}
