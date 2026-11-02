// profile.json: the personal eye profile, in Electron userData (never the repo). The gaze calibration keeps its own
// file (calibration/gaze.calib.json, store.ts) exactly as before; the profile holds a copy plus validation, game and gesture results.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ProfileData, ProfileSummary } from '../../../shared/profile-types'

const file = () => join(app.getPath('userData'), 'profile.json')

export function loadProfile(): ProfileData | null {
  try {
    if (!existsSync(file())) return null
    const j = JSON.parse(readFileSync(file(), 'utf8')) as ProfileData
    return j && j.version === 1 ? j : null
  } catch {
    return null
  }
}

export function saveProfile(p: unknown): boolean {
  try {
    const j = p as ProfileData
    if (!j || j.version !== 1) return false
    mkdirSync(app.getPath('userData'), { recursive: true })
    const tmp = file() + '.tmp'
    writeFileSync(tmp, JSON.stringify(j))
    renameSync(tmp, file()) // atomic: a crash never leaves half a profile
    return true
  } catch {
    return false
  }
}

export function profileSummary(): ProfileSummary | null {
  return loadProfile()?.summary ?? null
}
