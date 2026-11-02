// GLANCE_SCREENSHOT=1 GLANCE_SIMFLOW=1 GLANCE_SIM_CAMERA=1: drive the whole onboarding with synthetic face frames,
// screenshot each stage, and check that calibration is saved and gaze reaches the main process.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { Controller } from './controller'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runSimFlow(o: { main: () => BrowserWindow | null; overlay: () => BrowserWindow | null; controller: Controller; outDir: string; userData: string }): Promise<void> {
  mkdirSync(o.outDir, { recursive: true })
  const w = o.main()!
  const js = (code: string) => w.webContents.executeJavaScript(code, true)
  const shot = async (name: string, win: BrowserWindow | null = w) => {
    if (!win || win.isDestroyed()) return
    const img = await win.webContents.capturePage()
    writeFileSync(join(o.outDir, `flow-${name}.png`), img.toPNG())
    console.log('flow shot', name, img.getSize().width + 'x' + img.getSize().height)
  }
  const click = (text: string) =>
    js(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)}) && !b.disabled); if(b){b.click();return true} return false })()`)
  const waitFor = async (text: string, ms = 30000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await click(text)) return true
      await sleep(300)
    }
    console.log('FLOW timeout waiting for button', text)
    return false
  }
  await sleep(3000)
  await shot('1-welcome')
  await waitFor('Calibrate my eyes')
  await sleep(1200)
  await shot('2-camera')
  await waitFor('Start calibration')
  await sleep(4200)
  await shot('3-calibrating')
  const t0 = Date.now()
  // the fit screen shows the leave-one-out error
  while (Date.now() - t0 < 60000) {
    const txt = (await js('document.body.innerText')) as string
    if (/leave-one-out/i.test(txt)) {
      console.log('FLOW fit screen:', txt.replace(/\s+/g, ' ').slice(0, 220))
      break
    }
    await sleep(500)
  }
  await sleep(800)
  await shot('4-fit')
  // validation on unseen points -> verdict -> fine-tune (fullscreen rounds are automatic with the synthetic camera)
  await waitFor('Validate my eyes')
  const tv = Date.now()
  while (Date.now() - tv < 60000) {
    const txt = (await js('document.body.innerText')) as string
    if (/Eye validation/i.test(txt)) {
      console.log('FLOW validation:', txt.replace(/\s+/g, ' ').slice(0, 260))
      break
    }
    await sleep(500)
  }
  await sleep(800)
  await shot('4b-validation')
  if (await waitFor('Re-tune anyway', 4000) || (await waitFor('Fine-tune my eyes', 1500))) {
    const tt = Date.now()
    while (Date.now() - tt < 60000) {
      const txt = (await js('document.body.innerText')) as string
      if (/Fine-tune result/i.test(txt)) {
        console.log('FLOW fine-tune:', txt.replace(/\s+/g, ' ').slice(0, 360))
        break
      }
      await sleep(500)
    }
    await sleep(800)
    await shot('4c-finetune')
  }
  await waitFor('Continue to gestures')
  await sleep(1000)
  await shot('5-gestures')
  await waitFor('Skip')
  // Look and wink: scripted winker with the synthetic camera
  await sleep(1500)
  await shot('5b-game-intro')
  await waitFor('Start')
  await sleep(5000)
  await shot('5c-game-playing')
  const tg = Date.now()
  while (Date.now() - tg < 90000) {
    const txt = (await js('document.body.innerText')) as string
    if (/median time to wink/i.test(txt)) {
      console.log('FLOW game:', txt.replace(/\s+/g, ' ').slice(0, 200))
      break
    }
    await sleep(500)
  }
  await shot('5d-game-done')
  await waitFor('Finish setup')
  await sleep(2500)
  const gazeBefore = o.controller.gaze
  await sleep(1500)
  await shot('6-dashboard')
  await shot('7-overlay-live', o.overlay())
  // dashboard "Re-tune eyes (30 s)": validation, refit and fresh points in one fullscreen session
  if (await waitFor('Re-tune eyes', 4000)) {
    const tr = Date.now()
    while (Date.now() - tr < 90000) {
      const txt = (await js('document.body.innerText')) as string
      if (/Fine-tune result/i.test(txt)) {
        console.log('FLOW retune:', txt.replace(/\s+/g, ' ').slice(0, 420))
        break
      }
      await sleep(500)
    }
    await sleep(800)
    await shot('8-retune')
    await waitFor('Done')
    await sleep(1500)
    await shot('9-dashboard-after-retune')
  }
  const file = join(o.userData, 'calibration', 'gaze.calib.json')
  console.log('FLOW calibration saved:', existsSync(file), existsSync(file) ? statSync(file).size + ' bytes' : '')
  console.log('FLOW gaze reaches main:', !!o.controller.gaze, JSON.stringify(o.controller.gaze ?? gazeBefore))
  app.exit(0)
}
