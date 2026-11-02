// Offline word prediction: a small frequency list + bigrams. Pure and dependency free, so the renderer can use it for instant results.
// roughly by frequency (common English), good enough as an offline fallback
export const WORDS = (
  'the be to of and a in that have I it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had did does am ' +
  'hello hi hey thanks thank please yes yeah okay ok sure sorry help need needs love great nice fine today tomorrow tonight yesterday morning evening night home done doing going coming here where why while right left maybe really very much more many still never always again before later soon already something anything everything nothing someone everyone ' +
  'call text email message send read write reply meeting meet lunch dinner coffee water food call phone door light open close stop start wait ready late early quick slow friend family doctor nurse pain tired hungry cold hot happy sad glad ' +
  'today Monday Tuesday Wednesday Thursday Friday Saturday Sunday week month hour minute second ' +
  'would should could might must shall let put keep tell ask try feel leave call turn move live believe hold bring happen write provide sit stand lose pay meet include continue set learn change lead understand watch follow stop create speak read allow add spend grow ' +
  'works working worked wanted wants looking looks sounds sound seems found find having making getting taking knowing thinking saying doing being ' +
  'because though through during without between another every each both few those such own same different small large next early young important long little old big high great'
)
  .split(/\s+/)
  .filter((w, i, a) => w && a.indexOf(w) === i)

const BIGRAMS: Record<string, string[]> = {
  i: ['am', 'will', 'have'],
  you: ['are', 'can', 'will'],
  thank: ['you'],
  thanks: ['for', 'so', 'again'],
  see: ['you', 'it', 'the'],
  how: ['are', 'is', 'about'],
  can: ['you', 'we', 'I'],
  could: ['you', 'we', 'I'],
  would: ['you', 'be', 'like'],
  do: ['you', 'not', 'it'],
  let: ['me', 'us', 'it'],
  please: ['send', 'call', 'help'],
  i_am: ['not', 'going', 'ready'],
  the: ['best', 'same', 'first'],
  what: ['is', 'time', 'do'],
  good: ['morning', 'night', 'idea'],
  see_you: ['soon', 'later', 'tomorrow'],
  sounds: ['good', 'great', 'like'],
  is: ['it', 'there', 'that'],
  are: ['you', 'we', 'they'],
  to: ['the', 'be', 'see'],
  a: ['bit', 'little', 'few'],
  of: ['the', 'course', 'it'],
  in: ['the', 'a', 'my'],
  on: ['my', 'the', 'it'],
  my: ['name', 'phone', 'friend'],
  not: ['sure', 'now', 'yet'],
  no: ['problem', 'worries', 'thanks'],
}
const DEFAULT_NEXT = ['I', 'the', 'thanks']

/** Split "hello wor" into { prefix: "wor", prev: "hello", prev2: ... }. */
export function splitContext(text: string): { prefix: string; prev: string; prev2: string } {
  const m = text.match(/^([\s\S]*?)([A-Za-z'’]*)$/)
  const head = m?.[1] ?? ''
  const prefix = m?.[2] ?? ''
  const words = head.toLowerCase().match(/[a-z'’]+/g) ?? []
  const endsClean = /\s$/.test(head) || head === ''
  return { prefix, prev: endsClean ? (words[words.length - 1] ?? '') : '', prev2: endsClean ? (words[words.length - 2] ?? '') : '' }
}

export function offlinePredict(text: string, n = 3): string[] {
  const { prefix, prev, prev2 } = splitContext(text)
  const out: string[] = []
  const add = (w: string) => {
    if (w && !out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w)
  }
  if (prefix) {
    const p = prefix.toLowerCase()
    // bigram hints first when they match the prefix, then the frequency list
    for (const w of BIGRAMS[prev] ?? []) if (w.toLowerCase().startsWith(p) && w.toLowerCase() !== p) add(w)
    for (const w of WORDS) if (w.toLowerCase().startsWith(p) && w.toLowerCase() !== p) add(w)
    if (out.length === 0) add(prefix) // nothing known: offer the word as typed so the bar is never empty
  } else {
    for (const w of BIGRAMS[`${prev2}_${prev}`] ?? []) add(w)
    for (const w of BIGRAMS[prev] ?? []) add(w)
    for (const w of DEFAULT_NEXT) add(w)
  }
  return out.slice(0, n)
}

/** What to type when the user picks a word: the rest of the word (if mid-word) plus a space. */
export function wordInsertion(text: string, word: string): string {
  const { prefix } = splitContext(text)
  const rest = prefix && word.toLowerCase().startsWith(prefix.toLowerCase()) ? word.slice(prefix.length) : word
  return rest + ' '
}

