// Test driver (GLANCE_VOICE_E2E=<recording ms>): presses push-to-talk twice through the real renderer path
// (MediaRecorder + level meter + IPC + transcription), then quits. Pair it with Chromium's fake capture device:
//   --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>
// The intent call is stubbed in this mode (no click lands on the real screen); the result is logged as [voice-e2e].
import { app, type BrowserWindow } from 'electron'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function driveVoiceE2E(win: BrowserWindow, recordMs: number): Promise<void> {
  await new Promise<void>((res) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', () => res()) : res()))
  await wait(5000)
  console.log('[voice-e2e] press 1 (start)')
  win.webContents.send('ptt:toggle')
  await wait(recordMs)
  console.log('[voice-e2e] press 2 (stop)')
  win.webContents.send('ptt:toggle')
  await wait(11_000)
  console.log('[voice-e2e] done')
  app.quit()
}
