import { useEffect, useRef, useState } from 'react'
import { VoiceDebug } from '../components/voice/VoiceDebug'
import { ArrowLeft, Bug, Loader2, Mic, RotateCw, Send } from 'lucide-react'
import { Button } from '@glance/ui/components/button'
import { Badge } from '@glance/ui/components/badge'
import { Switch } from '@glance/ui/components/switch'
import { Mark } from '@glance/ui/components/mark'
import { cn } from '@glance/ui/lib/utils'
import type { IntentResult } from '../../shared/ipc'
import { useAppInfo, useEvent, useSettings } from '../lib/hooks'
import { AgentPanel } from '../components/agent/AgentPanel'
import { TypingStatsCard } from '../components/typing/TypingStats'
import { GazeErrorLine } from '../components/onboarding/GazeErrorLine'

const CHIPS = ['open that', 'click this one', 'reply', 'the invoice']

export function BrowseChrome() {
  const [settings, set] = useSettings()
  const info = useAppInfo()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [canBack, setCanBack] = useState(false)
  const [cmd, setCmd] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<IntentResult | null>(null)
  const [history, setHistory] = useState<IntentResult[]>([])
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.glance.invoke('intent:last').then((r) => r && setRes(r))
    void window.glance.invoke('browse:state').then((m) => {
      setUrl(m.url.startsWith('file://') ? 'Glance demo inbox (local)' : m.url)
      setTitle(m.title)
      setCanBack(m.canBack)
    })
  }, [])
  useEvent('browse:url', (m) => {
    if (document.activeElement !== urlRef.current) setUrl(m.url.startsWith('file://') ? 'Glance demo inbox (local)' : m.url)
    setTitle(m.title)
    setCanBack(m.canBack)
  })
  useEvent('intent:result', (r) => {
    setRes(r)
    setHistory((h) => [r, ...h].slice(0, 6))
    setBusy(false)
  })

  const run = async (c: string) => {
    if (!c.trim() || busy) return
    setBusy(true)
    try {
      await window.glance.invoke('intent:run', { command: c.trim(), source: 'typed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass-ground flex h-full flex-col text-white">
      {/* top bar */}
      <div className="drag flex shrink-0 items-center gap-2.5 pr-4" style={{ height: 64, paddingLeft: 92 }}>
        <Button variant="ghost" size="icon-sm" className="no-drag" disabled={!canBack} onClick={() => void window.glance.invoke('browse:back')}>
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" className="no-drag" onClick={() => void window.glance.invoke('browse:reload')}>
          <RotateCw />
        </Button>
        <form
          className="no-drag min-w-0 flex-[1.1]"
          onSubmit={(e) => {
            e.preventDefault()
            void window.glance.invoke('browse:navigate', url)
            urlRef.current?.blur()
          }}
        >
          <input
            ref={urlRef}
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter a URL"
            spellCheck={false}
            className="h-10 w-full rounded-full border border-white/15 bg-white/[0.06] px-4 text-sm text-white/85 outline-none placeholder:text-white/35 focus:border-white/40"
          />
        </form>
        <form
          className="no-drag relative min-w-0 flex-[1.2]"
          onSubmit={(e) => {
            e.preventDefault()
            void run(cmd)
          }}
        >
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder='Say or type a command: "open that"'
            spellCheck={false}
            className="h-10 w-full rounded-full border border-white/30 bg-white/[0.1] pl-4 pr-24 text-sm text-white outline-none shadow-[inset_0_1px_0_rgba(255,255,255,.35)] placeholder:text-white/45 focus:border-white/70"
          />
          <div className="absolute right-1 top-1 flex gap-1">
            <Button type="button" variant="ghost" size="icon-sm" title="Push to talk (Option+Space)" onClick={() => void window.glance.invoke('win:show', 'main')}>
              <Mic />
            </Button>
            <Button type="submit" size="icon-sm" disabled={busy || !cmd.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
        </form>
        <Button variant={settings?.debug ? 'glass' : 'ghost'} size="icon-sm" className="no-drag" title="Debug panel" onClick={() => settings && set({ debug: !settings.debug })}>
          <Bug />
        </Button>
      </div>

      {/* page area is the WebContentsView; the debug panel lives to its right */}
      <div className="flex min-h-0 flex-1">
        <div className="flex-1" />
        {settings?.debug && (
          <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto p-3 pl-0" style={{ width: 372 }}>
            <AgentPanel />
            <div className="glass glass-md flex flex-col gap-3 p-4">
              <div className="relative rounded-2xl border border-white/20 bg-black/40 px-3 py-2">
                <div className="eyebrow !text-[10px]">Model answering</div>
                <div className="font-mono text-[13px] text-white">{info ? `${info.provider} · ${info.model}` : '…'}</div>
              </div>
              <GazeErrorLine />
              <div className="relative flex items-center justify-between">
                <span className="eyebrow">Pick used</span>
                <Badge>{settings.pick === 'model' ? 'Model' : 'Nearest'}</Badge>
              </div>
              <div className="relative grid grid-cols-2 gap-1 rounded-full border border-white/15 bg-black/30 p-1">
                {(['model', 'nearest'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => set({ pick: p })}
                    className={cn('h-8 cursor-pointer rounded-full text-xs font-medium transition', settings.pick === p ? 'bg-white text-black' : 'text-white/60 hover:text-white')}
                  >
                    {p === 'model' ? 'Model pick' : 'Nearest to gaze'}
                  </button>
                ))}
              </div>
              <div className="relative flex items-center justify-between text-sm text-white/70">
                <span>Send the gaze point</span>
                <Switch checked={settings.withGaze} onCheckedChange={(v) => set({ withGaze: v })} />
              </div>
            </div>

            <div className="glass glass-md flex flex-col gap-3 p-4">
              <div className="relative flex items-center justify-between">
                <span className="eyebrow">Last decision</span>
                {res && <Badge>{res.source}</Badge>}
              </div>
              <VoiceDebug />
              {!res ? (
                <p className="relative text-sm text-white/50">Run a command. The model’s pick, latency and raw reply show up here.</p>
              ) : (
                <div className="relative flex flex-col gap-3">
                  <div className="text-lg font-semibold leading-tight tracking-tight">“{res.command}”</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat k="Latency" v={res.latencyMs ? `${res.latencyMs} ms` : '—'} big />
                    <Stat k="Elements" v={String(res.elementCount)} />
                  </div>
                  <Pick k="Model pick" id={res.modelPick} el={res.modelElement} hot={res.pickMode === 'model'} />
                  <Pick k="Nearest to gaze" id={res.nearestPick} el={res.nearestElement} hot={res.pickMode === 'nearest'} />
                  {res.modelPick !== null && res.nearestPick !== null && (
                    <div className="rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs text-white/70">
                      {res.modelPick === res.nearestPick ? 'Both pick the same element.' : 'They disagree: nearest-to-gaze would have clicked a different element.'}
                    </div>
                  )}
                  <div>
                    <div className="eyebrow mb-1.5">Raw reply</div>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/12 bg-black/50 p-2.5 font-mono text-[11px] leading-relaxed text-white/80">{res.raw || (res.error ? '' : '(empty)')}</pre>
                  </div>
                  {res.error && <div className="rounded-xl border border-white/30 bg-white/10 p-2.5 font-mono text-[11px] text-white/90">{res.error}</div>}
                  <div className="font-mono text-[10px] leading-relaxed text-white/40">
                    {res.provider} · {res.model}
                    <br />
                    gaze {res.gaze ? `${Math.round(res.gaze.x)}, ${Math.round(res.gaze.y)}` : 'none'} · viewport {res.viewport ? `${res.viewport.w}×${res.viewport.h}` : '—'}
                  </div>
                </div>
              )}
            </div>

            <TypingStatsCard />

            <div className="glass glass-md p-4">
              <div className="relative eyebrow mb-2">Try</div>
              <div className="relative flex flex-wrap gap-1.5">
                {CHIPS.map((c) => (
                  <button key={c} onClick={() => void run(c)} className="cursor-pointer rounded-full border border-white/20 bg-white/[0.07] px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/15">
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {history.length > 1 && (
              <div className="px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
                {history.slice(1).map((h) => (
                  <div key={h.ts} className="truncate">
                    {h.latencyMs}ms · “{h.command}” → {h.element?.name ?? 'none'}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-auto flex items-center gap-2 px-1 pb-1 text-white/40">
              <Mark size={16} />
              <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em]">{title || 'Glance'}</span>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function Stat({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.06] px-3 py-2">
      <div className="eyebrow !text-[10px]">{k}</div>
      <div className={cn('font-mono tabular-nums', big ? 'text-2xl font-medium' : 'text-xl')}>{v}</div>
    </div>
  )
}

function Pick({ k, id, el, hot }: { k: string; id: number | null; el: IntentResult['element']; hot: boolean }) {
  return (
    <div className={cn('rounded-2xl border px-3 py-2.5', hot ? 'border-white/70 bg-white/[0.14] shadow-[0_0_24px_rgba(255,255,255,.15)]' : 'border-white/15 bg-white/[0.04]')}>
      <div className="flex items-center justify-between">
        <div className="eyebrow !text-[10px]">{k}</div>
        {hot && <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white">acted on</div>}
      </div>
      <div className="mt-1 text-sm">{id === null ? <span className="text-white/45">none</span> : <><span className="font-mono text-white/60">[{id}]</span> {el ? <>{el.role} “{el.name}”</> : null}</>}</div>
    </div>
  )
}
