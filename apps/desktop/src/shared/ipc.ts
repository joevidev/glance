// Typed IPC contract between main, preload and renderers. Keys never cross this boundary.
import type { AgentState, ConfirmRequest } from './agent'
import type { TypingEvents, TypingInvoke } from './typing'
import type { ProfileInvoke } from './profile-types'
import type { SpeechReply, VoiceClientCode, VoiceResult } from './voice'

export interface Settings {
  /** Tracking paused: the cursor and gestures are ignored. Toggle with Alt+Shift+P. */
  paused: boolean
  /** The gaze drives the real cursor (native helper). */
  cursorControl: boolean
  /** Debug panel visible in the Browse window. */
  debug: boolean
  /** Ablation: which pick is acted on. 'nearest' = element nearest to the gaze, 'model' = the Fireworks model. */
  pick: 'model' | 'nearest'
  /** Ask the model with the gaze point (true) or with the command only (false). */
  withGaze: boolean
}

export interface AppInfo {
  fakeGaze: boolean
  platform: string
  hasFireworksKey: boolean
  hasOpenAIKey: boolean
  model: string
  provider: 'fireworks' | 'openai'
  display: { x: number; y: number; w: number; h: number; scale: number }
  screenshot: boolean
  /** GLANCE_SIM_CAMERA=1: synthetic face frames instead of the webcam (development without eyes). */
  simCamera: boolean
}

export interface InputStatus {
  running: boolean
  trusted: boolean
  error?: string
}

export interface ElementLite {
  id: number
  role: string
  name: string
  box: { x: number; y: number; w: number; h: number }
}

export interface IntentResult {
  ts: number
  command: string
  source: 'typed' | 'voice'
  /** What the model said. */
  modelPick: number | null
  /** The nearest element to the gaze (ablation baseline). */
  nearestPick: number | null
  /** The one we acted on, per the ablation switch. */
  actedOn: number | null
  pickMode: Settings['pick']
  latencyMs: number
  raw: string
  model: string
  provider: 'fireworks' | 'openai'
  error?: string
  elementCount: number
  gaze: { x: number; y: number } | null
  viewport: { w: number; h: number } | null
  element: ElementLite | null
  nearestElement: ElementLite | null
  modelElement: ElementLite | null
}

export interface InvokeMap extends TypingInvoke, ProfileInvoke {
  'app:info': [void, AppInfo]
  'input:status': [void, InputStatus]
  'input:requestAccess': [void, boolean]
  'calib:load': [void, unknown | null]
  'calib:save': [unknown, boolean]
  'calib:clear': [void, boolean]
  'calib:fullscreen': [boolean, void]
  'settings:get': [void, Settings]
  'settings:set': [Partial<Settings>, Settings]
  'browse:open': [string | undefined, void]
  'browse:navigate': [string, void]
  'browse:state': [void, { url: string; title: string; canBack: boolean }]
  'browse:back': [void, void]
  'browse:reload': [void, void]
  'intent:run': [{ command: string; source: 'typed' | 'voice' }, IntentResult]
  'intent:last': [void, IntentResult | null]
  'speech:transcribe': [{ audio: ArrayBuffer; mime: string; durationMs?: number; stopAt?: number }, SpeechReply]
  'assets:ready': [void, { ready: boolean; error?: string }]
  'win:show': ['main' | 'browse', void]
  'perm:media': [{ kind: 'camera' | 'microphone' }, string]
  'perm:openSettings': [string, void]
  'agent:run': [{ command: string; source: 'typed' | 'voice' }, AgentState]
  'agent:confirm': [{ id: number; ok: boolean }, boolean]
  'agent:state': [void, AgentState | null]
  'agent:voice': [boolean | undefined, boolean]
  'agent:demo': [void, void]
}

export interface GazeMsg {
  ts: number
  /** Smoothed gaze, normalized 0..1 of the primary display. null = no face / no point. */
  nx: number | null
  ny: number | null
  speed: number
  dwell: number
  held: boolean
}

export type GestureMsg =
  | { type: 'wink_left' | 'wink_right' | 'double_wink_left' | 'double_wink_right' | 'brows_up' | 'mouth_open_start' | 'mouth_open_end' }
  | { type: 'scroll'; velocity: number; dtMs: number }

export interface EngineStatus {
  state: 'idle' | 'loading' | 'tracking' | 'no-face' | 'error'
  fps: number
  message?: string
}

export interface SendMap {
  'gaze:frame': GazeMsg
  'gesture': GestureMsg
  'engine:status': EngineStatus
  'ptt:state': { recording: boolean }
  'voice:client-error': { code: VoiceClientCode; detail?: string }
}

export interface OverlayState {
  /** Gaze in overlay-local px. */
  gaze: { x: number; y: number } | null
  dwell: number
  ring: { x: number; y: number; w: number; h: number; name: string; role: string } | null
  toast: { id: number; text: string; sub?: string } | null
  radial: { cx: number; cy: number; hover: number | null; progress: number; items: { id: string; label: string }[] } | null
  recording: boolean
  paused: boolean
  fake: boolean
  dragging: boolean
  /** Assistant confirm card (an irreversible step waits for a wink or Enter). */
  confirm?: ConfirmRequest | null
}

export interface EventMap extends TypingEvents {
  'settings:changed': Settings
  'ptt:toggle': void
  'intent:result': IntentResult
  'voice:result': VoiceResult
  'overlay:state': OverlayState
  'input:status': InputStatus
  'toast': { text: string; sub?: string }
  'browse:url': { url: string; title: string; canBack: boolean }
  'agent:state': AgentState
}

export interface GlanceAPI {
  invoke<K extends keyof InvokeMap>(channel: K, arg?: InvokeMap[K][0]): Promise<InvokeMap[K][1]>
  send<K extends keyof SendMap>(channel: K, msg: SendMap[K]): void
  on<K extends keyof EventMap>(channel: K, cb: (msg: EventMap[K]) => void): () => void
}
