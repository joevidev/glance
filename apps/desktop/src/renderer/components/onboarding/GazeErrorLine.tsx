// One line for the Browse debug panel: the user's own measured gaze error. Display only: it is NOT sent to the model
// (the intent prompt is byte-pinned to the benchmark).
import { useProfileSummary } from './ProfileCard'

export function GazeErrorLine() {
  const s = useProfileSummary(5000)
  return (
    <div className="relative rounded-2xl border border-white/20 bg-black/40 px-3 py-2">
      <div className="eyebrow !text-[10px]">Your gaze error</div>
      <div className="font-mono text-[13px] text-white">
        {s && s.gazeErrorPx !== null ? `your gaze error ~${Math.round(s.gazeErrorPx)} px` : 'not measured yet'}
        {s?.simulated && <span className="ml-2 text-white/55">SIMULATED</span>}
      </div>
      {s && s.gazeErrorPx !== null && <div className="font-mono text-[10px] text-white/40">{s.errorSource === 'retune' ? 'after fine-tune' : s.errorSource === 'validation' ? 'validated on unseen points' : 'calibration leave-one-out'}</div>}
    </div>
  )
}
