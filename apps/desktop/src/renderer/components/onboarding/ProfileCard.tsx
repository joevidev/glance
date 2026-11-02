// Dashboard card: the personal eye model at a glance, plus "Re-tune eyes (30 s)".
import { useEffect, useState } from 'react'
import { Gamepad2, Sparkles } from 'lucide-react'
import { Button } from '@glance/ui/components/button'
import { Badge } from '@glance/ui/components/badge'
import { Card } from '@glance/ui/components/card'
import type { ProfileSummary } from '../../../shared/profile-types'
import { loadSummary, onProfileChanged } from '../../lib/profile'
import { fmtPx } from '../../lib/profile-stats'
import { SimBadge } from './ValidateFlow'

export function useProfileSummary(poll = 0): ProfileSummary | null {
  const [s, setS] = useState<ProfileSummary | null>(null)
  useEffect(() => {
    const load = () => void loadSummary().then(setS).catch(() => {})
    load()
    const off = onProfileChanged(load)
    const t = poll ? setInterval(load, poll) : null
    return () => {
      off()
      if (t) clearInterval(t)
    }
  }, [poll])
  return s
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never')

export function ProfileCard({ refreshKey, onRetune, onGame }: { refreshKey?: string; onRetune: () => void; onGame: () => void }) {
  const s = useProfileSummary()
  void refreshKey
  return (
    <Card className="gap-4 p-6">
      <div className="relative flex items-center justify-between">
        <div className="eyebrow">Eye model · yours</div>
        {s?.simulated && <SimBadge />}
      </div>
      {!s || s.gazeErrorPx === null ? (
        <p className="relative text-[14px] text-white/60">No personal profile yet. Calibrate your eyes to build one.</p>
      ) : (
        <div className="relative grid grid-cols-[auto_1fr] items-end gap-x-8 gap-y-3">
          <div className="flex items-end gap-3">
            <div className="font-mono text-5xl font-light tabular-nums leading-none">{Math.round(s.gazeErrorPx)}</div>
            <div className="pb-1 font-mono text-[11px] uppercase leading-snug tracking-[0.14em] text-white/55">px mean error<br />{s.errorSource === 'loo' ? 'leave-one-out' : s.errorSource === 'retune' ? 'after fine-tune' : 'unseen points'}</div>
            {s.verdict && <Badge className="mb-1">{s.verdict}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] text-white/70">
            <div><span className="text-white/40">Gestures </span>{s.gesturesWorking.length}/{s.gesturesTotal}{s.gesturesWorking.length ? ` · ${s.gesturesWorking.join(', ')}` : ''}</div>
            <div><span className="text-white/40">Game </span>{s.game ? `${s.game.hits}/${s.game.total}${s.game.medianMs ? ` · median ${(s.game.medianMs / 1000).toFixed(1)} s` : ''}` : 'not played'}</div>
            <div><span className="text-white/40">Fine-tune </span>{s.retune ? `${fmtPx(s.retune.beforePx)} → ${fmtPx(s.retune.afterPx)}` : 'none yet'}</div>
            <div><span className="text-white/40">Last tuned </span>{when(s.lastTunedAt)}</div>
          </div>
        </div>
      )}
      <div className="relative flex gap-2">
        <Button size="sm" onClick={onRetune}><Sparkles /> Re-tune eyes (30 s)</Button>
        <Button size="sm" variant="glass" onClick={onGame}><Gamepad2 /> Look and wink</Button>
      </div>
    </Card>
  )
}
