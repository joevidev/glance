// "Fine-tuning with your eyes": validation round on unseen points, verdict, the refit (personal model update) and the
// honest before/after. Used after the 9-point fit (mode 'onboarding') and from the dashboard (mode 'retune').
import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, Sparkles } from 'lucide-react'
import type { GazeCalibration } from '@glance/gaze'
import { Button } from '@glance/ui/components/button'
import { Badge } from '@glance/ui/components/badge'
import { Card } from '@glance/ui/components/card'
import { cn } from '@glance/ui/lib/utils'
import type { RetuneRecord, ValidationRecord, Verdict } from '../../../shared/profile-types'
import { TuneRun, type TuneOutput, type TunePlan } from './TuneRun'
import { VERDICT_NOTE, VERDICT_THRESHOLDS, evaluateSegments, fineTune, fmtPx, needsTune, verdictFor, type Evaluation, type Segment, type TuneResult } from '../../lib/profile-stats'
import { recordRetune, recordValidation } from '../../lib/profile'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
type Fit = { ok: boolean; looErrorPx: number; trainErrorPx: number; samples: number }

export const SimBadge = () => <Badge className="border-white/50 bg-white/15 font-mono tracking-[0.12em]">SIMULATED · synthetic camera</Badge>

export function ValidateFlow(p: {
  mode: 'onboarding' | 'retune'
  calib: GazeCalibration
  screen: { width: number; height: number }
  simulated: boolean
  /** called whenever the model changed (after a fine-tune): the caller keeps/saves the new calibration */
  onTuned: (calib: GazeCalibration, fit: Fit) => void
  onContinue: () => void
  onCancel: () => void
}) {
  const { screen, simulated } = p
  const [calib, setCalib] = useState(p.calib)
  const [phase, setPhase] = useState<'run' | 'result'>('run')
  const [plan, setPlan] = useState<TunePlan>(p.mode === 'retune' ? 'retune' : 'validate')
  const [val, setVal] = useState<{ ev: Evaluation; verdict: Verdict; segments: Segment[] } | null>(null)
  const [tune, setTune] = useState<TuneResult | null>(null)
  const [round, setRound] = useState(0)
  const first = useRef(true)

  // full screen for the target rounds, windowed for the results
  const enter = useCallback(async () => {
    await window.glance.invoke('calib:fullscreen', true)
    await sleep(900)
  }, [])
  const leave = useCallback(async () => {
    await window.glance.invoke('calib:fullscreen', false)
    await sleep(500)
  }, [])
  useEffect(() => {
    if (first.current) {
      first.current = false
      void enter().then(() => setRound((n) => n + 1))
    }
  }, [enter])

  const startRound = async (pl: TunePlan) => {
    setPlan(pl)
    setPhase('run')
    await enter()
    setRound((n) => n + 1)
  }

  const onRun = async (out: TuneOutput | null) => {
    await leave()
    if (!out) {
      // cancelled: keep what we had
      if (val) return setPhase('result')
      return p.onCancel()
    }
    const at = new Date().toISOString()
    let v = val
    if (out.validation) {
      const ev = evaluateSegments(calib, screen, out.validation)
      v = { ev, verdict: verdictFor(ev.stats.meanPx), segments: out.validation }
      setVal(v)
      setTune(null)
      const rec: ValidationRecord = { at, stats: ev.stats, verdict: v.verdict }
      void recordValidation(simulated, screen, rec)
    }
    if (out.fresh && v) {
      const r = fineTune(calib, v.segments, out.fresh, screen)
      setTune(r)
      const verdictAfter = verdictFor(r.after.stats.meanPx)
      const fit = r.tuned.fitResult
      if (r.fitOk && fit) {
        setCalib(r.tuned)
        p.onTuned(r.tuned, { ok: true, looErrorPx: fit.looErrorPx, trainErrorPx: fit.trainErrorPx, samples: fit.samples })
      }
      const rec: RetuneRecord = { at, samplesAdded: r.added, before: r.before.stats, after: r.after.stats, looBeforePx: r.looBeforePx, looAfterPx: r.looAfterPx, improved: r.improved, verdictAfter }
      // the saved calibration is rewritten by the caller (onTuned); the profile gets the record
      void recordRetune(simulated, screen, rec, null)
    }
    setPhase('result')
  }

  if (phase === 'run') return round > 0 ? <TuneRun key={round} plan={plan} onDone={(o) => void onRun(o)} /> : <div className="h-full" />

  if (!val) return null
  const showTune = tune !== null
  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto flex min-h-full max-w-[720px] flex-col justify-center gap-4 px-8 py-6">
      <div className="flex items-center justify-between">
        <div className="eyebrow">{showTune ? 'Fine-tune result' : 'Eye validation'}</div>
        {simulated && <SimBadge />}
      </div>
      <ValidationCard title="Six points your eyes had never seen" ev={val.ev} verdict={val.verdict} simulated={simulated} compact={showTune} />
      {tune && <TuneCard tune={tune} />}
      {!tune && needsTune(val.verdict) && <p className="text-[15px] leading-relaxed text-white/65">Worse than Good, so Glance can fine-tune: it adds the six points you just looked at to your calibration, fits again on every sample, then checks four fresh points and shows you before and after. About 15 seconds.</p>}
      <div className="flex flex-wrap gap-3">
        {!tune && needsTune(val.verdict) ? (
          <>
            <Button onClick={() => void startRound('refit')}><Sparkles /> Fine-tune my eyes (15 s)</Button>
            <Button variant="glass" onClick={p.onContinue}>{p.mode === 'retune' ? 'Done' : 'Continue to gestures'}</Button>
          </>
        ) : (
          <>
            <Button onClick={p.onContinue}>{p.mode === 'retune' ? 'Done' : 'Continue to gestures'}</Button>
            {!tune && <Button variant="glass" onClick={() => void startRound('refit')}><Sparkles /> Re-tune anyway (15 s)</Button>}
          </>
        )}
        <Button variant="ghost" onClick={() => void startRound(p.mode === 'retune' ? 'retune' : 'validate')}><RotateCcw /> Redo validation</Button>
      </div>
    </div>
    </div>
  )
}

function Big({ v, label }: { v: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-6xl font-light tabular-nums leading-none">{v}</div>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">{label}</div>
    </div>
  )
}

function ValidationCard({ title, ev, verdict, simulated, compact }: { compact?: boolean; title: string; ev: Evaluation; verdict: Verdict; simulated: boolean }) {
  const s = ev.stats
  return (
    <Card className="gap-5 p-7">
      <div className="relative flex items-start justify-between">
        <div className="text-[15px] text-white/70">{title}</div>
        <Badge>{verdict}</Badge>
      </div>
      <div className="relative flex items-end gap-10">
        <Big v={Number.isFinite(s.meanPx) ? String(Math.round(s.meanPx)) : '—'} label="px mean error" />
        <Big v={Number.isFinite(s.medianPx) ? String(Math.round(s.medianPx)) : '—'} label="px median" />
        <div className="ml-auto font-mono text-[11px] uppercase leading-relaxed tracking-[0.12em] text-white/40">{s.n} of {ev.perTarget.length} points measured<br />worst {fmtPx(s.maxPx)}</div>
      </div>
      <div className="relative flex flex-wrap gap-1.5">
        {ev.perTarget.map((t, i) => (
          <span key={i} className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] tabular-nums text-white/70">{t.errorPx === null ? 'missed' : Math.round(t.errorPx)}</span>
        ))}
      </div>
      {!compact && <p className="relative text-[14px] leading-relaxed text-white/65">
        {VERDICT_NOTE[verdict]} Measured on points not in the calibration, through the same smoothing the live cursor uses{simulated ? '. These numbers come from a synthetic face: they say nothing about a real webcam (expect 100 to 200 px)' : ''}.
        <span className="text-white/40"> Excellent under {VERDICT_THRESHOLDS.excellent}, Good under {VERDICT_THRESHOLDS.good}, Usable under {VERDICT_THRESHOLDS.usable} px.</span>
      </p>}
    </Card>
  )
}

function TuneCard({ tune }: { tune: TuneResult }) {
  const b = tune.before.stats
  const a = tune.after.stats
  const delta = a.meanPx - b.meanPx
  return (
    <Card className="gap-4 p-7">
      <div className="relative flex items-start justify-between">
        <div className="text-[15px] text-white/70">Your model, before and after the fine-tune (same four fresh points)</div>
        <Badge className={cn(!tune.improved && 'opacity-80')}>{tune.improved ? 'Improved' : 'No improvement'}</Badge>
      </div>
      <div className="relative flex items-end gap-6">
        <Big v={fmtPx(b.meanPx).replace(' px', '')} label="px before" />
        <div className="pb-6 font-mono text-3xl text-white/40">→</div>
        <Big v={fmtPx(a.meanPx).replace(' px', '')} label="px after" />
        <div className="ml-auto text-right font-mono text-[11px] uppercase leading-relaxed tracking-[0.12em] text-white/45">
          {delta <= 0 ? '' : '+'}{Math.round(delta)} px<br />{tune.added} samples added<br />leave-one-out {Math.round(tune.looBeforePx)} → {Math.round(tune.looAfterPx)} px
        </div>
      </div>
      <p className="relative text-[13px] leading-relaxed text-white/55">Median {fmtPx(b.medianPx)} → {fmtPx(a.medianPx)}. Reported as measured: a fine-tune can help a lot, a little, or not at all, and four points are a small sample.{!tune.fitOk ? ' The refit did not converge, so the old model is kept.' : ''}</p>
    </Card>
  )
}
