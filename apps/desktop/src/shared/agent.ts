// Types shared by main and the renderers for the multi-step assistant ("Jarvis"). Types only.

export type AgentActionName = 'click' | 'type' | 'key' | 'scroll' | 'done' | 'ask'

export interface AgentAction {
  action: AgentActionName
  /** Element id from the CURRENT observation (click, type). */
  target: number | null
  /** type: the text; key: Enter|Tab|Escape; scroll: up|down; done/ask: the message. */
  text: string | null
  reason: string
}

export type AgentStepStatus = 'ok' | 'error' | 'confirm' | 'declined' | 'done' | 'ask' | 'noeffect'

export interface AgentStep {
  n: number
  action: AgentActionName
  /** Name of the target element at the time of the step (ids are not stable between steps). */
  target: string | null
  text: string | null
  reason: string
  /** Model latency of this step. */
  modelMs: number
  /** Time to execute + settle (and to wait for the user, for a confirmed step: see waitMs). */
  execMs: number
  /** Time spent waiting for the user on a confirm card. */
  waitMs: number
  irreversible: boolean
  status: AgentStepStatus
  note?: string
}

export interface ConfirmRequest {
  id: number
  title: string
  detail: string
  /** The exact action that will run on confirm. */
  actionName: string
  hint: string
}

export type AgentStatus = 'running' | 'confirming' | 'done' | 'asked' | 'error' | 'cancelled' | 'max_steps' | 'stuck'

export interface AgentState {
  id: number
  command: string
  source: 'typed' | 'voice'
  status: AgentStatus
  steps: AgentStep[]
  pending: ConfirmRequest | null
  startedAt: number
  endedAt: number | null
  model: string
  provider: string
  tokensIn: number
  tokensOut: number
  message: string
  maxSteps: number
}
