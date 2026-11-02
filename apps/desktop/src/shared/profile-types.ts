// Personal eye profile: the shape of profile.json (Electron userData, never the repo) and its small summary.
// Pure types only, shared by main (persistence) and renderers.

export type Verdict = 'Excellent' | 'Good' | 'Usable' | 'Redo'

export interface ErrStats {
  /** targets that produced a measurement */
  n: number
  meanPx: number
  medianPx: number
  maxPx: number
  /** one error per target (px), in target order; targets with too few usable frames are left out */
  errorsPx: number[]
}

export interface ValidationRecord {
  at: string
  stats: ErrStats
  verdict: Verdict
}

export interface RetuneRecord {
  at: string
  samplesAdded: number
  /** the pre-fine-tune model and the tuned model, both scored on the SAME 4 fresh targets */
  before: ErrStats
  after: ErrStats
  looBeforePx: number
  looAfterPx: number
  improved: boolean
  verdictAfter: Verdict
}

export interface GameTrial {
  target: string
  picked: string | null
  hit: boolean
  /** prompt shown -> wink, ms (null = no wink before the timeout) */
  timeMs: number | null
  /** distance from the smoothed gaze to the target centre at the wink, px */
  gazeErrPx: number | null
  timedOut: boolean
}

export interface GameRecord {
  at: string
  trials: GameTrial[]
  hits: number
  total: number
  medianMs: number | null
  misses: number
}

export interface GestureRecord {
  at: string
  works: { winkLeft: boolean; winkRight: boolean; mouthOpen: boolean; browsUp: boolean }
  separation: Record<string, number>
  swapEyes: boolean
}

export interface ProfileSummary {
  /** The personal gaze error shown in the debug panel. */
  gazeErrorPx: number | null
  errorSource: 'retune' | 'validation' | 'loo' | null
  medianPx: number | null
  verdict: Verdict | null
  looErrorPx: number | null
  /** true when the numbers came from the synthetic camera (GLANCE_SIM_CAMERA): never a real user's error */
  simulated: boolean
  gesturesWorking: string[]
  gesturesTotal: number
  game: { hits: number; total: number; medianMs: number | null } | null
  retune: { beforePx: number; afterPx: number } | null
  lastTunedAt: string | null
}

export interface ProfileData {
  version: 1
  createdAt: string
  updatedAt: string
  simulated: boolean
  screen: { width: number; height: number } | null
  /** copy of the saved gaze calibration (same object as gaze.calib.json) */
  calibration: unknown | null
  validation: ValidationRecord | null
  retune: RetuneRecord | null
  game: GameRecord | null
  gestures: GestureRecord | null
  history: { at: string; kind: 'validation' | 'retune'; meanPx: number; simulated: boolean }[]
  summary: ProfileSummary | null
}

/** Invoke channels of the personal profile (merged into InvokeMap in ipc.ts). */
export interface ProfileInvoke {
  'profile:load': [void, ProfileData | null]
  'profile:save': [unknown, boolean]
  'profile:summary': [void, ProfileSummary | null]
}
