import { useCallback, useEffect, useRef, useState } from 'react'
import { useVoiceRecorder, type VoiceUi } from '../components/voice/useVoiceRecorder'
import { VoiceStatus } from '../components/voice/VoiceStatus'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Camera, Globe, Keyboard, Mic, MousePointer2, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { GestureCalibrator, type GazeCalibration, type GazeFrame } from '@glance/gaze'
import { Button } from '@glance/ui/components/button'
import { Badge } from '@glance/ui/components/badge'
import { Card } from '@glance/ui/components/card'
import { Progress } from '@glance/ui/components/progress'
import { ProgressRing } from '@glance/ui/components/progress-ring'
import { Switch } from '@glance/ui/components/switch'
import { Wordmark, Mark } from '@glance/ui/components/mark'
import { cn } from '@glance/ui/lib/utils'
import { engine, type SavedCalibration } from '../lib/engine'
import { useEngineStatus } from '../lib/useEngine'
import { useAppInfo, useEvent, useInputStatus, useSettings } from '../lib/hooks'
import { CameraPreview } from '../components/CameraPreview'
import { CalibrationRun, GESTURE_STEPS, collectGesture, type CalibResult } from './Calibrate'
import { ValidateFlow } from '../components/onboarding/ValidateFlow'
import { LookAndWink } from '../components/onboarding/LookAndWink'
import { ProfileCard } from '../components/onboarding/ProfileCard'
import { recordCalibration, recordGestures } from '../lib/profile'

type Step = 'boot' | 'welcome' | 'camera' | 'calibrating' | 'fit' | 'validate' | 'retune' | 'gestures' | 'game' | 'dashboard'

const quality = (px: number): { label: string; note: string } => {
  if (!Number.isFinite(px)) return { label: 'Failed', note: 'The fit did not converge. Sit closer, light your face from the front, and try again.' }
  if (px < 90) return { label: 'Excellent', note: 'Tight enough to pick between neighbouring links.' }
  if (px < 150) return { label: 'Good', note: 'Typical for a webcam. The model resolves the rest.' }
  if (px < 250) return { label: 'Usable', note: 'Works, but a recalibration with steadier head and better light will help.' }
  return { label: 'Poor', note: 'Too noisy. Recalibrate: face lit from the front, no window behind you, head still.' }
}

export function MainApp() {
  const info = useAppInfo()
  const [settings, set] = useSettings()
  const input = useInputStatus()
  const status = useEngineStatus()
  const [step, setStep] = useState<Step>('boot')
  const [saved, setSaved] = useState<SavedCalibration | null>(null)
  const [pending, setPending] = useState<{ calib: GazeCalibration; fit: CalibResult['fit'] } | null>(null)
  const voice = useVoiceRecorder()
  const { heard, recording, mic, toggle: toggleRecording } = voice
  const screenSize = info ? { width: info.display.w, height: info.display.h } : { width: window.screen.width, height: window.screen.height }

  // load calibration, start the camera
  useEffect(() => {
    void (async () => {
      const j = (await window.glance.invoke('calib:load')) as SavedCalibration | null
      if (j && j.version === 1) {
        setSaved(j)
        engine.applyCalibration(j)
        engine.driving = true
        setStep('dashboard')
      } else setStep('welcome')
      const inf = await window.glance.invoke('app:info')
      if (inf.simCamera) engine.startSim()
      else engine.start().catch(() => {})
    })()
  }, [])

  // push to talk (Option+Space or the radial menu mic): components/voice

  const startCalibration = async () => {
    setStep('camera')
  }

  const beginFullscreenCalibration = async () => {
    engine.driving = false
    await window.glance.invoke('calib:fullscreen', true)
    await new Promise((r) => setTimeout(r, 900))
    setStep('calibrating')
  }

  const onCalibDone = async (r: { calib: GazeCalibration; fit: CalibResult['fit'] } | null) => {
    await window.glance.invoke('calib:fullscreen', false)
    await new Promise((r) => setTimeout(r, 500))
    if (!r) return setStep(saved ? 'dashboard' : 'camera')
    setPending(r)
    setStep('fit')
  }

  const finish = async (g: { thresholds: SavedCalibration['thresholds']; works: SavedCalibration['works']; separation: Record<string, number>; swapEyes: boolean }) => {
    if (!pending) return
    const s: SavedCalibration = {
      version: 1,
      calib: pending.calib.toJSON(),
      screen: screenSize,
      thresholds: g.thresholds,
      works: g.works,
      separation: g.separation,
      swapEyes: g.swapEyes,
      looErrorPx: pending.fit.looErrorPx,
      savedAt: new Date().toISOString(),
    }
    await window.glance.invoke('calib:save', s)
    setSaved(s)
    engine.applyCalibration(s)
    engine.driving = true
    void recordGestures(!!info?.simCamera, screenSize, s)
    setStep(flow.current === 'dash' ? 'dashboard' : 'game')
  }

  // personal profile: validation round, fine-tune and the Look and wink game (components/onboarding)
  const flow = useRef<'onboard' | 'dash'>('onboard')
  const onTuned = (calib: GazeCalibration, fit: CalibResult['fit']) => {
    if (step === 'retune' && saved) {
      const s: SavedCalibration = { ...saved, calib: calib.toJSON(), looErrorPx: fit.looErrorPx, savedAt: new Date().toISOString() }
      void window.glance.invoke('calib:save', s).then(() => recordCalibration(!!info?.simCamera, screenSize, s))
      setSaved(s)
      engine.applyCalibration(s)
    } else setPending({ calib, fit })
  }

  return (
    <div className="glass-ground relative flex h-full flex-col overflow-hidden text-white">
      {step !== 'calibrating' && (
        <header className="drag flex h-14 shrink-0 items-center justify-between pl-24 pr-6">
          <Wordmark size={24} />
          <div className="no-drag flex items-center gap-2">
            {info?.fakeGaze && <Badge>Fake gaze · mouse</Badge>}
            <Badge>{status.state === 'tracking' ? `${status.fps} fps` : status.state}</Badge>
          </div>
        </header>
      )}
      <AnimatePresence mode="wait">
        <motion.main key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="min-h-0 flex-1">
          {step === 'boot' && <div className="flex h-full items-center justify-center"><Mark size={72} className="animate-pulse" /></div>}
          {step === 'welcome' && <Welcome info={info} input={input} status={status} onNext={startCalibration} onFake={() => setStep('dashboard')} />}
          {step === 'camera' && <CameraStep status={status} onBack={() => setStep(saved ? 'dashboard' : 'welcome')} onNext={beginFullscreenCalibration} />}
          {step === 'calibrating' && <CalibrationRun screen={screenSize} onDone={onCalibDone} />}
          {step === 'fit' && pending && <FitStep simulated={!!info?.simCamera} fit={pending.fit} onRetry={beginFullscreenCalibration} onNext={() => setStep('validate')} />}
          {step === 'validate' && pending && <ValidateFlow mode="onboarding" calib={pending.calib} screen={screenSize} simulated={!!info?.simCamera} onTuned={onTuned} onContinue={() => setStep('gestures')} onCancel={() => setStep('fit')} />}
          {step === 'retune' && saved && <ValidateFlow mode="retune" calib={GazeCalibrationFrom(saved)} screen={screenSize} simulated={!!info?.simCamera} onTuned={onTuned} onContinue={() => { engine.driving = true; setStep('dashboard') }} onCancel={() => { engine.driving = true; setStep('dashboard') }} />}
          {step === 'game' && saved && <LookAndWink saved={saved} display={info?.display ?? null} simulated={!!info?.simCamera} onDone={() => setStep('dashboard')} onSkip={() => setStep('dashboard')} />}
          {step === 'gestures' && <GestureStep onDone={finish} onSkip={() => void finish({ thresholds: engineDefaults(), works: { winkLeft: true, winkRight: true, mouthOpen: true, browsUp: true }, separation: {}, swapEyes: false })} />}
          {step === 'dashboard' && (
            <Dashboard
              info={info}
              settings={settings}
              set={set}
              input={input}
              status={status}
              saved={saved}
              heard={heard}
              recording={recording}
              mic={mic}
              onPtt={toggleRecording}
              voice={voice}
              onRecalibrate={() => { flow.current = 'onboard'; setStep('camera') }}
              onRetune={() => { flow.current = 'dash'; engine.driving = false; setStep('retune') }}
              onGame={() => { flow.current = 'dash'; engine.driving = false; setStep('game') }}
              onGestures={() => {
                flow.current = 'dash'
                engine.driving = false
                if (saved) setPending({ calib: GazeCalibrationFrom(saved), fit: { ok: true, looErrorPx: saved.looErrorPx, trainErrorPx: 0, samples: 0 } })
                setStep('gestures')
              }}
            />
          )}
        </motion.main>
      </AnimatePresence>
    </div>
  )
}

import { GazeCalibration as GC, DEFAULT_THRESHOLDS } from '@glance/gaze'
const GazeCalibrationFrom = (s: SavedCalibration) => GC.fromJSON(s.calib)
const engineDefaults = () => ({ ...DEFAULT_THRESHOLDS })

// ---------------------------------------------------------------- welcome
function Row({ ok, title, desc, action }: { ok: boolean | null; title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-3xl border border-white/15 bg-white/[0.05] px-5 py-4">
      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border', ok ? 'border-white bg-white text-black' : 'border-white/30 text-white/50')}>{ok ? <Check className="size-4" /> : <X className="size-4" />}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{title}</div>
        <div className="text-[13px] leading-snug text-white/55">{desc}</div>
      </div>
      {action}
    </div>
  )
}

function Welcome({ info, input, status, onNext, onFake }: { info: ReturnType<typeof useAppInfo>; input: ReturnType<typeof useInputStatus>; status: ReturnType<typeof useEngineStatus>; onNext: () => void; onFake: () => void }) {
  const camOk = status.state === 'tracking' || status.state === 'no-face'
  return (
    <div className="mx-auto flex h-full max-w-[760px] flex-col justify-center gap-6 px-8 pb-10">
      <div>
        <div className="eyebrow mb-3">Welcome</div>
        <h1 className="headline text-[46px] leading-[1.02]">Your assistant can hear you.<br /><em>Now it can see what you see.</em></h1>
      </div>
      <div className="flex flex-col gap-2.5">
        <Row ok={camOk} title="Camera" desc={status.state === 'error' ? (status.message ?? 'Camera error') : camOk ? 'Face tracker running locally.' : (status.message ?? 'Waiting for permission…')} action={!camOk && <Button size="sm" variant="glass" onClick={() => void window.glance.invoke('perm:openSettings', 'Camera')}>Open Settings</Button>} />
        <Row ok={!!input?.trusted} title="Accessibility" desc={input?.trusted ? 'Glance can move the cursor and click.' : 'Needed to move the real cursor and click. macOS will ask once.'} action={!input?.trusted && <Button size="sm" variant="glass" onClick={() => void window.glance.invoke('input:requestAccess')}>Allow</Button>} />
        <Row ok={info?.provider === 'openai' ? !!info?.hasOpenAIKey : !!info?.hasFireworksKey} title={info?.provider === 'openai' ? 'OpenAI key' : 'Fireworks key'} desc={(info?.provider === 'openai' ? info?.hasOpenAIKey : info?.hasFireworksKey) ? `Intent model: ${info?.provider} · ${info?.model}` : `${info?.provider === 'openai' ? 'OPENAI_API_KEY' : 'FIREWORKS_API_KEY'} not found in the repo .env.`} />
      </div>
      <div className="flex items-center gap-3">
        <Button size="lg" onClick={onNext} disabled={!camOk}>Calibrate my eyes</Button>
        {info?.fakeGaze && <Button size="lg" variant="glass" onClick={onFake}>Skip (fake gaze)</Button>}
        <span className="text-sm text-white/45">About one minute.</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- camera
function CameraStep({ status, onBack, onNext }: { status: ReturnType<typeof useEngineStatus>; onBack: () => void; onNext: () => void }) {
  const ok = status.state === 'tracking'
  return (
    <div className="mx-auto grid h-full max-w-[900px] grid-cols-[1.1fr_1fr] items-center gap-10 px-8 pb-10">
      <CameraPreview />
      <div className="flex flex-col gap-5">
        <div>
          <div className="eyebrow mb-2">Step 1 of 4</div>
          <h2 className="headline text-4xl leading-tight">Can I see your eyes?</h2>
        </div>
        <p className="text-[15px] leading-relaxed text-white/60">The white rings should sit on your irises. Sit about an arm’s length away, face lit from the front, no window behind you. After calibration, keep the same seat.</p>
        <div className="flex items-center gap-3">
          <ProgressRing progress={ok ? 1 : 0.15} size={36} stroke={3} />
          <span className="text-sm text-white/70">{ok ? 'Face found. Looking good.' : status.state === 'error' ? status.message : (status.message ?? 'Looking for your face…')}</span>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button onClick={onNext} disabled={!ok}>Start calibration</Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- fit result
function FitStep({ fit, onRetry, onNext, simulated }: { simulated?: boolean; fit: CalibResult['fit']; onRetry: () => void; onNext: () => void }) {
  const q = quality(fit.ok ? fit.looErrorPx : Infinity)
  return (
    <div className="mx-auto flex h-full max-w-[640px] flex-col justify-center gap-6 px-8 pb-10">
      <div className="flex items-center justify-between"><div className="eyebrow">Calibration result</div>{simulated && <Badge className="border-white/50 bg-white/15 font-mono tracking-[0.12em]">SIMULATED · synthetic camera</Badge>}</div>
      <Card className="gap-5 p-8">
        <div className="relative flex items-end gap-4">
          <div className="font-mono text-7xl font-light tabular-nums leading-none">{fit.ok ? Math.round(fit.looErrorPx) : '—'}</div>
          <div className="pb-2 font-mono text-sm uppercase tracking-[0.14em] text-white/55">px error<br />leave-one-out</div>
          <Badge className="ml-auto mb-2">{q.label}</Badge>
        </div>
        <Progress value={fit.ok ? Math.max(4, 100 - Math.min(100, (fit.looErrorPx / 300) * 100)) : 0} />
        <p className="relative text-[15px] leading-relaxed text-white/65">{q.note} Honest number: each dot is predicted from the other eight, so it is not flattered by memorising.</p>
        <div className="relative font-mono text-[11px] uppercase tracking-[0.12em] text-white/40">{fit.samples} samples · train error {Number.isFinite(fit.trainErrorPx) ? Math.round(fit.trainErrorPx) : '—'} px</div>
      </Card>
      <div className="flex gap-3">
        <Button variant="glass" onClick={onRetry}><RotateCcw /> Recalibrate</Button>
        <Button onClick={onNext} disabled={!fit.ok}>Validate my eyes</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- gesture training
function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">{label}</div>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/12"><div className="h-full rounded-full bg-white" style={{ width: `${Math.round(v * 100)}%`, transition: 'width .06s' }} /></div>
    </div>
  )
}

function GestureStep({ onDone, onSkip }: { onDone: (g: { thresholds: SavedCalibration['thresholds']; works: SavedCalibration['works']; separation: Record<string, number>; swapEyes: boolean }) => void; onSkip: () => void }) {
  const cal = useRef(new GestureCalibrator()).current
  const [i, setI] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'ready' | 'hold'>('idle')
  const [p, setP] = useState(0)
  const [live, setLive] = useState<GazeFrame | null>(null)
  const [result, setResult] = useState<ReturnType<GestureCalibrator['result']> | null>(null)
  const swap = useRef({ l: 0, r: 0 })
  const [swapEyes, setSwapEyes] = useState(false)
  useEffect(() => engine.subscribe((f) => setLive(f)), [])

  const run = async () => {
    const step = GESTURE_STEPS[i]!
    setPhase('ready')
    await new Promise((r) => setTimeout(r, 1100))
    setPhase('hold')
    const r = await collectGesture(cal, step.key, step.key === 'neutral' ? 3000 : 2200, (pp) => setP(pp))
    if (step.key === 'winkLeft') swap.current = { l: r.meanL, r: r.meanR }
    setPhase('idle')
    setP(0)
    if (i + 1 < GESTURE_STEPS.length) setI(i + 1)
    else {
      const res = cal.result()
      // if the "left" wink drove the right eye signal, the camera labels are the other way round
      const sw = swap.current.r > swap.current.l + 0.3
      setSwapEyes(sw)
      setResult(res)
    }
  }

  if (result) {
    const rows: { k: keyof typeof result.works; name: string; use: string }[] = [
      { k: 'winkLeft', name: 'Wink left', use: 'Left click' },
      { k: 'winkRight', name: 'Wink right', use: 'Right click' },
      { k: 'mouthOpen', name: 'Open mouth', use: 'Drag' },
      { k: 'browsUp', name: 'Raise brows', use: 'Scroll with a nod' },
    ]
    return (
      <div className="mx-auto flex h-full max-w-[680px] flex-col justify-center gap-5 px-8 pb-10">
        <div>
          <div className="eyebrow mb-2">Step 3 of 4</div>
          <h2 className="headline text-4xl">Gestures that work for you</h2>
        </div>
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <Row key={r.k} ok={result.works[r.k]} title={`${r.name} → ${r.use}`} desc={result.works[r.k] ? `Clear signal (separation ${result.separation[r.k].toFixed(2)}).` : `Not reliable for you (separation ${result.separation[r.k].toFixed(2)}). Left unbound.`} />
          ))}
        </div>
        {swapEyes && <div className="rounded-2xl border border-white/25 bg-white/10 px-4 py-3 text-sm text-white/80">Left and right looked swapped on the camera: Glance corrected it automatically.</div>}
        <div className="flex gap-3">
          <Button variant="glass" onClick={() => { setResult(null); setI(0) }}><RotateCcw /> Redo</Button>
          <Button onClick={() => onDone({ thresholds: result.thresholds, works: result.works, separation: result.separation, swapEyes })}>Finish setup</Button>
        </div>
      </div>
    )
  }

  const step = GESTURE_STEPS[i]!
  return (
    <div className="mx-auto grid h-full max-w-[900px] grid-cols-[1fr_1fr] items-center gap-10 px-8 pb-10">
      <CameraPreview />
      <div className="flex flex-col gap-5">
        <div>
          <div className="eyebrow mb-2">Step 3 of 4 · {i + 1} / {GESTURE_STEPS.length}</div>
          <h2 className="headline text-4xl">{step.title}</h2>
          <p className="mt-2 text-[15px] text-white/60">{step.hint}</p>
        </div>
        <div className="flex flex-col gap-2 rounded-3xl border border-white/12 bg-black/30 p-4">
          <Meter label="Eye L" v={live?.blinkLeft ?? 0} />
          <Meter label="Eye R" v={live?.blinkRight ?? 0} />
          <Meter label="Mouth" v={live?.jawOpen ?? 0} />
          <Meter label="Brows" v={live?.browUp ?? 0} />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void run()} disabled={phase !== 'idle'}>
            {phase === 'idle' ? (i === 0 ? 'Start' : 'Ready') : phase === 'ready' ? 'Get ready…' : 'Hold it…'}
          </Button>
          {phase === 'hold' && <ProgressRing progress={p} size={34} />}
          <Button variant="ghost" onClick={onSkip}>Skip</Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- dashboard
function Tile({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="glass glass-md flex flex-col gap-1 px-4 py-3">
      <div className="relative eyebrow !text-[10px]">{k}</div>
      <div className="relative flex items-center gap-2 text-[15px]">
        <span className={cn('size-1.5 rounded-full', ok === false ? 'bg-white/30' : 'bg-white shadow-[0_0_8px_rgba(255,255,255,.9)]')} />
        {v}
      </div>
    </div>
  )
}

function Dashboard(p: {
  info: ReturnType<typeof useAppInfo>
  settings: ReturnType<typeof useSettings>[0]
  set: ReturnType<typeof useSettings>[1]
  input: ReturnType<typeof useInputStatus>
  status: ReturnType<typeof useEngineStatus>
  saved: SavedCalibration | null
  heard: string | null
  recording: boolean
  mic: string
  voice: VoiceUi
  onPtt: () => void
  onRecalibrate: () => void
  onRetune: () => void
  onGame: () => void
  onGestures: () => void
}) {
  const { info, settings, set, input, status, saved } = p
  const works = saved?.works
  const [invert, setInvert] = useState(engine.invertScroll)
  return (
    <div className="grid h-full grid-cols-[330px_1fr] gap-5 px-6 pb-6">
      <div className="flex flex-col gap-4">
        <CameraPreview />
        <div className="grid grid-cols-2 gap-2.5">
          <Tile k="Camera" v={status.state === 'tracking' ? `${status.fps} fps` : status.state} ok={status.state === 'tracking'} />
          <Tile k="Accessibility" v={input?.trusted ? 'Allowed' : 'Missing'} ok={!!input?.trusted} />
          <Tile k="Gaze error" v={saved ? `${Math.round(saved.looErrorPx)} px` : info?.fakeGaze ? 'mouse' : 'not calibrated'} ok={!!saved || !!info?.fakeGaze} />
          <Tile k={info?.provider === 'openai' ? 'OpenAI' : 'Fireworks'} v={(info?.provider === 'openai' ? info?.hasOpenAIKey : info?.hasFireworksKey) ? 'Key set' : 'No key'} ok={!!(info?.provider === 'openai' ? info?.hasOpenAIKey : info?.hasFireworksKey)} />
        </div>
        {!input?.trusted && input && (
          <div className="rounded-2xl border border-white/30 bg-white/10 p-3 text-[13px] leading-snug text-white/85">
            {input.error ?? 'Accessibility is not allowed yet.'}
            <Button size="sm" className="mt-2" onClick={() => void window.glance.invoke('input:requestAccess')}>Allow Accessibility</Button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <Card className="gap-5 p-7">
          <div className="relative flex items-start justify-between">
            <div>
              <div className="eyebrow mb-2">Run your laptop with your eyes</div>
              <div className="headline text-3xl leading-tight">Look. Wink. Say it.</div>
            </div>
            <Button size="lg" onClick={() => void window.glance.invoke('win:show', 'browse')}><Globe /> Open Browse</Button>
          </div>
          <div className="relative grid grid-cols-2 gap-x-6 gap-y-3">
            <Toggle icon={<MousePointer2 className="size-4" />} label="Eyes move the cursor" desc={info?.fakeGaze ? 'Off in fake-gaze mode' : 'Gaze never clicks by itself'} checked={!!settings?.cursorControl && !info?.fakeGaze} disabled={info?.fakeGaze} onChange={(v) => set({ cursorControl: v })} />
            <Toggle icon={<ShieldCheck className="size-4" />} label="Pause tracking" desc="Alt+Shift+P anywhere" checked={!!settings?.paused} onChange={(v) => set({ paused: v })} />
            <Toggle icon={<Keyboard className="size-4" />} label="Invert scroll direction" desc="Brows up + nod to scroll" checked={invert} onChange={(v) => { engine.setInvertScroll(v); setInvert(v) }} />
          </div>
        </Card>

        <Card className="gap-4 p-6">
          <div className="relative flex items-center justify-between">
            <div className="eyebrow">Say a command</div>
            <Badge>Option + Space</Badge>
          </div>
          <div className="relative flex items-center gap-4">
            <Button size="lg" variant={p.recording ? 'default' : 'glass'} onClick={p.onPtt}>
              <Mic /> {p.recording ? 'Stop & send' : 'Push to talk'}
            </Button>
            <VoiceStatus voice={p.voice} />
          </div>
        </Card>

        <ProfileCard refreshKey={saved?.savedAt} onRetune={p.onRetune} onGame={p.onGame} />

        <Card className="gap-3 p-6">
          <div className="relative eyebrow">Gestures</div>
          <div className="relative grid grid-cols-2 gap-2 text-[14px]">
            <G ok={works?.winkLeft} a="Wink left" b="Left click" />
            <G ok={works?.winkRight} a="Wink right" b="Right click" />
            <G ok={works?.winkLeft} a="Double wink" b="Double click" />
            <G ok={works?.mouthOpen} a="Open mouth" b="Drag (close = drop)" />
            <G ok={works?.browsUp} a="Brows up + nod" b="Scroll" />
            <G ok a="Hold gaze 1 s" b="Radial menu" />
          </div>
          <div className="relative flex gap-2 pt-1">
            <Button variant="glass" size="sm" onClick={p.onRecalibrate}><Camera /> Recalibrate eyes</Button>
            <Button variant="ghost" size="sm" onClick={p.onGestures}>Retrain gestures</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Toggle({ icon, label, desc, checked, onChange, disabled }: { icon: React.ReactNode; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3', disabled && 'opacity-50')}>
      <div className="flex size-9 items-center justify-center rounded-full border border-white/20 bg-white/[0.06] text-white/80">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{label}</div>
        <div className="truncate text-[12px] text-white/50">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}
function G({ ok, a, b }: { ok?: boolean; a: string; b: string }) {
  return (
    <div className={cn('flex items-center justify-between rounded-2xl border px-3.5 py-2', ok === false ? 'border-white/10 text-white/30 line-through' : 'border-white/15 bg-white/[0.04]')}>
      <span>{a}</span>
      <span className="text-white/55">{b}</span>
    </div>
  )
}
