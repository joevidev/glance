// Typing counters for the Browse debug panel: characters typed vs keystrokes the user made, and words per minute.
import { useEffect, useState } from 'react'
import { Keyboard } from 'lucide-react'
import { Button } from '@glance/ui/components/button'
import type { TypingStatsMsg } from '../../../shared/typing'

export function TypingStatsCard() {
  const [s, setS] = useState<TypingStatsMsg | null>(null)
  useEffect(() => {
    void window.glance.invoke('typing:stats').then(setS)
    return window.glance.on('typing:stats', setS)
  }, [])
  const cell = (k: string, v: string, big = false) => (
    <div className="rounded-2xl border border-white/15 bg-white/[0.06] px-3 py-2">
      <div className="eyebrow !text-[10px]">{k}</div>
      <div className={'font-mono tabular-nums ' + (big ? 'text-2xl font-medium' : 'text-xl')}>{v}</div>
    </div>
  )
  return (
    <div className="glass glass-md flex flex-col gap-3 p-4" data-testid="typing-stats">
      <div className="relative flex items-center justify-between">
        <span className="eyebrow">Typing with eyes</span>
        <Button size="sm" variant="glass" onClick={() => void window.glance.invoke('typing:open')}>
          <Keyboard /> Type
        </Button>
      </div>
      <div className="relative grid grid-cols-2 gap-2">
        {cell('Characters', String(s?.chars ?? 0))}
        {cell('Keystrokes', String(s?.keystrokes ?? 0))}
        {cell('Chars / key', s && s.keystrokes ? s.charsPerKeystroke.toFixed(1) : '-')}
        {cell('Words / min', s && s.wpm ? s.wpm.toFixed(0) : '-', true)}
      </div>
      <div className="relative font-mono text-[10px] leading-relaxed text-white/45">
        {s && s.keyboardWpm ? `gaze keyboard only ${s.keyboardWpm.toFixed(1)} wpm · ` : ''}
        {s?.lastSuggestMs != null ? `replies ${s.lastSuggestMs} ms · ${s.suggestModel}` : 'replies: not requested yet'}
      </div>
    </div>
  )
}
