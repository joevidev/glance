// Renderer side of the personal profile: load, merge, save (through main), and a tiny change event for the UI.
import type { GestureRecord, GameRecord, ProfileData, ProfileSummary, RetuneRecord, ValidationRecord } from '../../shared/profile-types'
import { buildSummary, emptyProfile } from './profile-stats'
import type { SavedCalibration } from './engine'

type Listener = () => void
const listeners = new Set<Listener>()
export const onProfileChanged = (cb: Listener): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

let chain: Promise<unknown> = Promise.resolve()

/** Serialized read-modify-write so two quick updates never lose each other. */
export function updateProfile(simulated: boolean, screen: { width: number; height: number } | null, mut: (p: ProfileData) => void): Promise<ProfileData> {
  const run = async (): Promise<ProfileData> => {
    const cur = ((await window.glance.invoke('profile:load')) as ProfileData | null) ?? emptyProfile(simulated, screen)
    cur.simulated = simulated
    if (screen) cur.screen = screen
    mut(cur)
    cur.updatedAt = new Date().toISOString()
    cur.summary = buildSummary(cur)
    await window.glance.invoke('profile:save', cur)
    for (const l of listeners) l()
    return cur
  }
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

export const loadSummary = (): Promise<ProfileSummary | null> => window.glance.invoke('profile:summary')

export const recordCalibration = (sim: boolean, screen: { width: number; height: number }, saved: SavedCalibration) =>
  updateProfile(sim, screen, (p) => {
    p.calibration = saved
  })

export const recordGestures = (sim: boolean, screen: { width: number; height: number }, saved: SavedCalibration) =>
  updateProfile(sim, screen, (p) => {
    p.calibration = saved
    const g: GestureRecord = { at: new Date().toISOString(), works: saved.works, separation: saved.separation ?? {}, swapEyes: saved.swapEyes }
    p.gestures = g
  })

export const recordValidation = (sim: boolean, screen: { width: number; height: number }, v: ValidationRecord) =>
  updateProfile(sim, screen, (p) => {
    p.validation = v
    p.history.push({ at: v.at, kind: 'validation', meanPx: v.stats.meanPx, simulated: sim })
  })

export const recordRetune = (sim: boolean, screen: { width: number; height: number }, r: RetuneRecord, saved: SavedCalibration | null) =>
  updateProfile(sim, screen, (p) => {
    p.retune = r
    if (saved) p.calibration = saved
    p.history.push({ at: r.at, kind: 'retune', meanPx: r.after.meanPx, simulated: sim })
  })

export const recordGame = (sim: boolean, screen: { width: number; height: number }, g: GameRecord) =>
  updateProfile(sim, screen, (p) => {
    p.game = g
  })
