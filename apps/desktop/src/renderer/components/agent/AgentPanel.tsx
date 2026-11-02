import { useEffect, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { Button } from '@glance/ui/components/button'
import { Badge } from '@glance/ui/components/badge'
import { Switch } from '@glance/ui/components/switch'
import { cn } from '@glance/ui/lib/utils'
import type { AgentState } from '../../../shared/agent'
import { useEvent } from '../../lib/hooks'

const CHIPS = ['reply yes, tomorrow at 3 works', 'schedule it']
const ICON: Record<string, string> = { ok: '✓', error: '!', confirm: '…', declined: '✕', done: '✓', ask: '?', noeffect: '·' }

/** The assistant: typed command box, voice-mode switch, live step trace and the confirm buttons (debug panel). */
export function AgentPanel() {
  const [cmd, setCmd] = useState('')
  const [st, setSt] = useState<AgentState | null>(null)
  const [voice, setVoice] = useState(true)
  const busy = st?.status === 'running' || st?.status === 'confirming'

  useEffect(() => {
    void window.glance.invoke('agent:state').then((s) => s && setSt(s))
    void window.glance.invoke('agent:voice').then(setVoice)
  }, [])
  useEvent('agent:state', setSt)

  const run = (c: string) => {
    if (!c.trim() || busy) return
    void window.glance.invoke('agent:run', { command: c.trim(), source: 'typed' })
  }
  const secs = st ? (((st.endedAt ?? Date.now()) - st.startedAt) / 1000).toFixed(1) : '0'

  return (
    <div className="glass glass-md flex flex-col gap-3 p-4">
      <div className="relative flex items-center justify-between">
        <span className="eyebrow">Assistant</span>
        {st && <Badge>{st.status === 'confirming' ? 'needs OK' : st.status}</Badge>}
      </div>
      <form
        className="relative flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          run(cmd)
        }}
      >
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder='Ask it to do something: "schedule it"'
          spellCheck={false}
          className="h-9 min-w-0 flex-1 rounded-full border border-white/30 bg-white/[0.1] px-3.5 text-[13px] text-white outline-none placeholder:text-white/45 focus:border-white/70"
        />
        <Button type="submit" size="icon-sm" disabled={busy || !cmd.trim()} title="Run the task">
          {busy ? <Loader2 className="animate-spin" /> : <Play />}
        </Button>
      </form>
      <div className="relative flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button key={c} onClick={() => run(c)} disabled={busy} className="cursor-pointer rounded-full border border-white/20 bg-white/[0.07] px-3 py-1 text-[11px] text-white/80 transition hover:bg-white/15 disabled:opacity-40">
            {c}
          </button>
        ))}
        <button onClick={() => void window.glance.invoke('agent:demo')} className="cursor-pointer rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/60 transition hover:bg-white/15">
          open demo mail
        </button>
      </div>
      <div className="relative flex items-center justify-between text-[13px] text-white/70">
        <span>Voice runs the assistant</span>
        <Switch checked={voice} onCheckedChange={(v) => void window.glance.invoke('agent:voice', v).then(setVoice)} />
      </div>

      {st?.pending && (
        <div className="relative rounded-2xl border border-white/70 bg-white/[0.14] p-3 shadow-[0_0_24px_rgba(255,255,255,.18)]">
          <div className="eyebrow !text-[10px]">Needs your OK</div>
          <div className="mt-0.5 text-[15px] font-semibold">{st.pending.title}</div>
          <div className="font-mono text-[11px] text-white/70">{st.pending.actionName}</div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void window.glance.invoke('agent:confirm', { id: st.pending!.id, ok: true })}>
              Do it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void window.glance.invoke('agent:confirm', { id: st.pending!.id, ok: false })}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {st && (
        <div className="relative flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="eyebrow !text-[10px]">Steps {st.steps.length}/{st.maxSteps}</div>
            <div className="font-mono text-[10px] text-white/50">{secs} s · {st.tokensIn + st.tokensOut} tok</div>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-white/12 bg-black/40 p-2 font-mono text-[11px] leading-relaxed">
            {st.steps.map((s) => (
              <div key={s.n} className={cn('flex gap-1.5', s.status === 'error' || s.status === 'declined' ? 'text-white/50' : 'text-white/85')}>
                <span className="w-3 shrink-0 text-white/50">{s.n}</span>
                <span className="w-3 shrink-0">{ICON[s.status] ?? ''}</span>
                <span className="min-w-0 flex-1 truncate">
                  {s.action}
                  {s.target ? ` “${s.target}”` : ''}
                  {s.action === 'type' && s.text ? ` = ${s.text.slice(0, 24)}` : ''}
                  {s.irreversible ? ' ⚠' : ''}
                </span>
                <span className="shrink-0 text-white/45">{s.modelMs + s.execMs} ms</span>
              </div>
            ))}
            {st.steps.length === 0 && <div className="text-white/40">starting…</div>}
          </div>
          {st.message && <div className="text-[12px] leading-snug text-white/75">{st.message}</div>}
          <div className="font-mono text-[10px] text-white/35">{st.provider} · {st.model}</div>
        </div>
      )}
    </div>
  )
}
