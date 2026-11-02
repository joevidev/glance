// Small persisted state in Electron userData: settings and the personal calibration. Never inside the repo.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Settings } from '../shared/ipc'

export const DEFAULT_SETTINGS: Settings = { paused: false, cursorControl: true, radialDwell: false, debug: true, pick: 'model', withGaze: true, magnet: true }

const dir = () => {
  const d = join(app.getPath('userData'), 'calibration')
  mkdirSync(d, { recursive: true })
  return d
}
const calibFile = () => join(dir(), 'gaze.calib.json')
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

export function loadCalibration(): unknown | null {
  try {
    return existsSync(calibFile()) ? JSON.parse(readFileSync(calibFile(), 'utf8')) : null
  } catch {
    return null
  }
}
export function saveCalibration(j: unknown): boolean {
  try {
    writeFileSync(calibFile(), JSON.stringify(j))
    return true
  } catch {
    return false
  }
}
export function clearCalibration(): boolean {
  try {
    rmSync(calibFile(), { force: true })
    return true
  } catch {
    return false
  }
}

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
    // paused never persists: the app always starts live
    return { ...DEFAULT_SETTINGS, ...s, paused: false }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
export function saveSettings(s: Settings): void {
  try {
    writeFileSync(settingsFile(), JSON.stringify(s))
  } catch {
    /* ignore */
  }
}
