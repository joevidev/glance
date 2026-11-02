import { useState } from 'react'
import type { VoiceResult } from '../../../shared/voice'
import { useEvent } from '../../lib/hooks'

/** Debug panel block: what the speech model heard, what was sent as the command, speech latency and where the gaze came from. */
export function VoiceDebug() {
  const [v, setV] = useState<VoiceResult | null>(null)
  useEvent('voice:result', setV)
  if (!v) return null
  return (
    <div className="relative rounded-2xl border border-white/15 bg-white/[0.06] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="eyebrow !text-[10px]">Heard (speech to text)</div>
        <div className="font-mono text-[10px] text-white/50">{v.sttMs ? `${v.sttMs} ms` : ''}</div>
      </div>
      <div className="mt-1 break-words font-mono text-[12px] text-white/90">{v.raw ? `“${v.raw}”` : <span className="text-white/45">nothing</span>}</div>
      {v.command && v.command !== v.raw && <div className="mt-1 break-words font-mono text-[11px] text-white/60">sent as “{v.command}”</div>}
      {v.error && <div className="mt-1 font-mono text-[11px] text-white/80">{v.code}: {v.error}</div>}
      <div className="mt-1 font-mono text-[10px] text-white/40">
        gaze {v.gaze ? `${Math.round(v.gaze.x)}, ${Math.round(v.gaze.y)} · ${v.gaze.source} (${v.gaze.samples} samples)` : 'none'}
      </div>
    </div>
  )
}
