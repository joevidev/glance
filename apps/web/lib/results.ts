// Everything on /results is derived from data/summary.json, which scripts/sync-results.mjs
// copies from ../../results/summary.json at build time. No number in the UI is typed by hand.
import raw from "../data/summary.json"

type SystemStats = {
  n: number
  complete: boolean
  acc: number
  cost_per_1k: number | null
  latency_p50_ms: number | null
  latency_p95_ms: number | null
  n_pred_none: number
  n_truncated_length: number
  n_pred_wrong_id: number
}
export type Pair = {
  a: string
  b: string
  n: number
  n_sites: number
  n_only_a: number
  n_only_b: number
  acc_a: number
  acc_b: number
  mcnemar_p: number
  boot_diff_pts: number
  boot_ci95: [number, number]
  verdict: string
}
type Cell = { acc: number; n: number }
export type Summary = {
  frontier_name: string
  n_test: number
  n_sites: number
  acc_ci95_site_bootstrap: Record<string, [number, number]>
  systems: Record<string, SystemStats>
  not_run: string[]
  pairs: Record<string, Pair>
  by_command_type: Record<string, Record<string, Cell>>
  by_sigma: Record<string, Record<string, Cell>>
  headline: string
  latency_note: string
  method: { mcnemar: string; bootstrap: string; real_gain_rule: string }
}

export const summary = raw as unknown as Summary

/** Display order is by accuracy, computed, so a changed summary re-sorts itself. */
export const SYSTEM_KEYS = [
  "raw_gaze",
  "nearest",
  "open_cmd_only",
  "harness_top5",
  "lora",
  "frontier_geo",
  "open_base",
  "frontier",
  "open_base_flash",
] as const

export const LABEL: Record<string, string> = {
  raw_gaze: "Raw gaze point",
  nearest: "Nearest element to the gaze",
  open_cmd_only: "Open model, command only (no gaze)",
  harness_top5: "Open model, 5 nearest elements only",
  lora: "Open model + our LoRA",
  frontier_geo: "Frontier, distance-to-gaze prompt",
  open_base: "Open model (glm-5p3)",
  frontier: `Frontier (${summary.frontier_name})`,
  open_base_flash: "Open model, untrained flash",
  harness_vote: "Open model, 5-sample vote",
  open_base_geo: "Open model, distance-to-gaze prompt",
}
export const SHORT: Record<string, string> = {
  raw_gaze: "raw gaze",
  nearest: "nearest",
  open_cmd_only: "cmd only",
  harness_top5: "top-5",
  lora: "LoRA",
  frontier_geo: "frontier geo",
  open_base: "open base",
  frontier: "frontier",
  open_base_flash: "flash",
}

export const ranked = [...SYSTEM_KEYS]
  .filter((k) => summary.systems[k])
  .sort((a, b) => summary.systems[b]!.acc - summary.systems[a]!.acc)

export const isModel = (k: string) => !["raw_gaze", "nearest"].includes(k)

export const pct = (v: number, d = 1) => `${v.toFixed(d)}%`
export const signed = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`
export const usd = (v: number) => `$${v.toFixed(v < 1 ? 2 : 2)}`
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`
export function fmtP(p: number) {
  if (p >= 0.001) return p.toFixed(p < 0.1 ? 3 : 2)
  const [m, e] = p.toExponential(0).split("e")
  return `${m}e${Number(e)}`
}

export const pair = (name: string) => {
  const p = summary.pairs[name]
  if (!p) throw new Error(`summary.json has no pair ${name}`)
  return p
}
export const sys = (k: string) => {
  const s = summary.systems[k]
  if (!s) throw new Error(`summary.json has no system ${k}`)
  return s
}

export const PAIR_LABEL: Record<string, string> = {
  lora_vs_open_base: "LoRA vs its own base model",
  lora_vs_open_base_flash: "LoRA vs untrained flash model",
  lora_vs_frontier: "LoRA vs frontier",
  lora_vs_nearest: "LoRA vs nearest element",
  open_base_vs_open_cmd_only: "Gaze + command vs command only (open model)",
  open_base_vs_nearest: "Open model vs nearest element",
  open_base_vs_frontier: "Open model vs frontier",
  open_base_flash_vs_frontier: "Untrained flash vs frontier",
  frontier_vs_nearest: "Frontier vs nearest element",
  frontier_geo_vs_frontier: "Frontier, distance prompt vs plain prompt",
}
