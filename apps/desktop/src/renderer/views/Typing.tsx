// Typing mode panel: three reply suggestions + a gaze keyboard with word prediction. Dwell about 1 s (or a left wink) selects.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CornerDownLeft, Delete, Keyboard, MessageSquareText, RefreshCw, X } from 'lucide-react'
import { GazeKey } from '../components/typing/GazeKey'
import { useGazeSelect } from '../components/typing/useGazeSelect'
import { offlinePredict, wordInsertion } from '../../main/features/typing/offline'
import type { SuggestResult, TypingMode, TypingSource, TypingStatsMsg } from '../../shared/typing'

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const PUNCT = [',', '.', '?', '!', "'"]
const DWELL_REPLY = 1000
const DWELL_KEY = 800

const dwellFor = (id: string): number => (id.startsWith('k:') || id.startsWith('w:') ? DWELL_KEY : DWELL_REPLY)

export function Typing() {
  const [mode, setMode] = useState<TypingMode>('replies')
  const [sug, setSug] = useState<SuggestResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [preds, setPreds] = useState<string[]>(offlinePredict(''))
  const [stats, setStats] = useState<TypingStatsMsg | null>(null)
  const [flash, setFlash] = useState('')
  const textRef = useRef('')
  const sugRef = useRef<SuggestResult | null>(null)
  const predsRef = useRef<string[]>(preds)
  const seq = useRef(0)
  sugRef.current = sug
  predsRef.current = preds

  useEffect(() => {
    document.documentElement.classList.add('overlay')
    void window.glance.invoke('app:info').then((i) => {
      if (i.screenshot) document.documentElement.style.setProperty('background', '#3a3a3a', 'important')
    })
  }, [])

  const loadSuggestions = useCallback(() => {
    setLoading(true)
    void window.glance.invoke('typing:suggest').then((r) => {
      setSug(r)
      setLoading(false)
    })
  }, [])
  useEffect(() => {
    loadSuggestions()
    void window.glance.invoke('typing:stats').then(setStats)
    const offS = window.glance.on('typing:stats', setStats)
    const offO = window.glance.on('typing:opened', () => {
      textRef.current = ''
      setText('')
      setMode('replies')
      loadSuggestions()
    })
    return () => {
      offS()
      offO()
    }
  }, [loadSuggestions])

  const refreshPreds = (t: string) => {
    const my = ++seq.current
    setPreds(offlinePredict(t)) // instant, offline
    void window.glance.invoke('typing:predict', { text: t.slice(-120) }).then((r) => {
      if (my === seq.current && r.source === 'model') setPreds(r.words)
    })
  }
  const append = (s: string) => {
    textRef.current += s
    setText(textRef.current)
    refreshPreds(textRef.current)
  }
  const typeText = async (s: string, source: TypingSource) => {
    const r = await window.glance.invoke('typing:type', { text: s, source })
    if (!r.ok) setFlash(r.error ?? 'typing failed')
    else append(s)
  }
  const setModeBoth = (m: TypingMode) => {
    setMode(m)
    void window.glance.invoke('typing:mode', { mode: m })
  }

  const select = (id: string) => {
    const [kind, arg = ''] = [id.slice(0, 1), id.slice(2)]
    setFlash('')
    if (kind === 's') {
      const t = sugRef.current?.items[Number(arg)]
      if (t) void typeText(t, 'suggestion')
    } else if (kind === 'w') {
      const w = predsRef.current[Number(arg)]
      if (w) void typeText(wordInsertion(textRef.current, w), 'word')
    } else if (kind === 'k') {
      if (arg === 'space') void typeText(' ', 'key')
      else if (arg === 'back') {
        void window.glance.invoke('typing:key', { key: 'delete', source: 'key' })
        textRef.current = textRef.current.slice(0, -1)
        setText(textRef.current)
        refreshPreds(textRef.current)
      } else if (arg === 'enter') {
        void window.glance.invoke('typing:key', { key: 'return', source: 'key' })
        textRef.current = ''
        setText('')
        refreshPreds('')
      } else if (arg === 'done') {
        void window.glance.invoke('typing:close')
      } else void typeText(arg, 'key')
    } else if (kind === 'm') setModeBoth(arg === 'keys' ? 'keys' : 'replies')
    else if (kind === 'r') loadSuggestions()
    else if (kind === 'x') void window.glance.invoke('typing:close')
  }

  const { hot, gaze } = useGazeSelect(select, dwellFor)

  const statLine = stats ? `${stats.chars} chars · ${stats.keystrokes} keystrokes · ${stats.wpm ? stats.wpm.toFixed(0) : 0} wpm` : ''

  return (
    <div data-hot={hot ? `${hot.id}:${hot.p.toFixed(2)}` : ""} className="relative flex h-full w-full select-none flex-col gap-3 p-1 text-white">
      <div className="glass glass-md flex h-full flex-col gap-3 p-4" style={{ borderRadius: 36 }}>
        {/* header */}
        <div className="relative flex items-center gap-3">
          <span className="eyebrow">Type with your eyes</span>
          <div className="min-w-0 flex-1 truncate rounded-full border border-white/15 bg-black/40 px-4 py-1.5 font-mono text-[13px] text-white/85" data-testid="buffer">
            {text || <span className="text-white/35">look at a reply or a key, hold 1 s or wink</span>}
            <span className="ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] animate-pulse bg-white" />
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/55" data-testid="statline">{statLine}</span>
        </div>

        {mode === 'replies' ? (
          <>
            <div className="relative grid flex-1 grid-cols-3 gap-3" style={{ minHeight: 0 }}>
              {[0, 1, 2].map((i) => (
                <GazeKey key={i} id={`s:${i}`} hot={hot} onPress={() => select(`s:${i}`)} className="px-6 text-center" style={{ borderRadius: 28 }}>
                  {loading ? (
                    <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-white/45">thinking…</span>
                  ) : (
                    <span className="text-[22px] font-medium leading-snug tracking-tight">{sug?.items[i] ?? ''}</span>
                  )}
                </GazeKey>
              ))}
            </div>
            <div className="relative grid grid-cols-4 gap-3" style={{ height: 64 }}>
              <GazeKey id="k:enter" hot={hot} onPress={() => select('k:enter')} style={{ borderRadius: 999 }}>
                <span className="flex items-center gap-2 text-[16px]"><CornerDownLeft className="size-5" /> Send / enter</span>
              </GazeKey>
              <GazeKey id="r:new" hot={hot} onPress={() => select('r:new')} style={{ borderRadius: 999 }}>
                <span className="flex items-center gap-2 text-[16px]"><RefreshCw className="size-5" /> New replies</span>
              </GazeKey>
              <GazeKey id="m:keys" hot={hot} onPress={() => select('m:keys')} style={{ borderRadius: 999 }}>
                <span className="flex items-center gap-2 text-[16px]"><Keyboard className="size-5" /> Keyboard</span>
              </GazeKey>
              <GazeKey id="x:close" hot={hot} onPress={() => select('x:close')} style={{ borderRadius: 999 }}>
                <span className="flex items-center gap-2 text-[16px]"><X className="size-5" /> Close</span>
              </GazeKey>
            </div>
          </>
        ) : (
          <>
            {/* word prediction bar */}
            <div className="relative grid grid-cols-3 gap-3" style={{ height: 70 }}>
              {[0, 1, 2].map((i) => (
                <GazeKey key={i} id={`w:${i}`} hot={hot} onPress={() => select(`w:${i}`)} style={{ borderRadius: 999 }}>
                  <span className="text-[24px] font-medium tracking-tight">{preds[i] ?? ''}</span>
                </GazeKey>
              ))}
            </div>
            <div className="relative flex flex-1 flex-col gap-2.5" style={{ minHeight: 0 }}>
              {ROWS.map((row, ri) => (
                <div key={row} className="flex flex-1 justify-center gap-2.5">
                  {[...row].map((c) => (
                    <GazeKey key={c} id={`k:${c}`} hot={hot} onPress={() => select(`k:${c}`)} className="flex-1" style={{ borderRadius: 22, maxWidth: 104 }}>
                      <span className="text-[30px] font-medium uppercase">{c}</span>
                    </GazeKey>
                  ))}
                  {ri === 2 && (
                    <GazeKey id="k:back" hot={hot} onPress={() => select('k:back')} className="flex-[1.6]" style={{ borderRadius: 22, maxWidth: 170 }}>
                      <Delete className="size-8" strokeWidth={1.6} />
                    </GazeKey>
                  )}
                </div>
              ))}
              <div className="flex flex-1 justify-center gap-2.5">
                <GazeKey id="m:replies" hot={hot} onPress={() => select('m:replies')} className="flex-[1.4]" style={{ borderRadius: 22 }}>
                  <span className="flex items-center gap-2 text-[15px]"><MessageSquareText className="size-5" /> Replies</span>
                </GazeKey>
                {PUNCT.map((c) => (
                  <GazeKey key={c} id={`k:${c}`} hot={hot} onPress={() => select(`k:${c}`)} className="flex-[0.6]" style={{ borderRadius: 22 }}>
                    <span className="text-[28px]">{c}</span>
                  </GazeKey>
                ))}
                <GazeKey id="k:space" hot={hot} onPress={() => select('k:space')} className="flex-[3]" style={{ borderRadius: 22 }}>
                  <span className="font-mono text-[13px] uppercase tracking-[0.2em] text-white/70">space</span>
                </GazeKey>
                <GazeKey id="k:enter" hot={hot} onPress={() => select('k:enter')} className="flex-[1.2]" style={{ borderRadius: 22 }}>
                  <CornerDownLeft className="size-7" strokeWidth={1.6} />
                </GazeKey>
                <GazeKey id="k:done" hot={hot} onPress={() => select('k:done')} className="flex-[1.2]" style={{ borderRadius: 22 }}>
                  <span className="flex items-center gap-2 text-[16px]"><Check className="size-5" /> Done</span>
                </GazeKey>
              </div>
            </div>
          </>
        )}

        <div className="relative flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
          <span>
            {sug ? `${sug.source === 'model' ? sug.model : 'offline replies'} · ${sug.latencyMs} ms · ${sug.context.app.slice(0, 40)}` : ' '}
            {flash ? ` · ${flash}` : ''}
          </span>
          <span>hold 1 s or wink to select</span>
        </div>
      </div>

      {/* gaze point over the panel */}
      {gaze && (
        <div data-testid="gazedot" className="pointer-events-none absolute" style={{ left: gaze.x, top: gaze.y }}>
          <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ width: 12, height: 12, boxShadow: '0 0 0 2px rgba(0,0,0,.55), 0 0 12px 2px rgba(255,255,255,.9)' }} />
        </div>
      )}
    </div>
  )
}
