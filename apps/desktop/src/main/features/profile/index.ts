import { ipcMain } from 'electron'
import { loadProfile, profileSummary, saveProfile } from './store'

/** IPC for the personal eye profile. The keys never touch this: it only moves the profile JSON between renderer and disk. */
export function registerProfileIpc(): void {
  ipcMain.handle('profile:load', () => loadProfile())
  ipcMain.handle('profile:save', (_e, p: unknown) => saveProfile(p))
  ipcMain.handle('profile:summary', () => profileSummary())
}
