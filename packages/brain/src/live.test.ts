// Live check against Fireworks. Skipped unless GLANCE_LIVE=1. Loads the repo-root .env in process; never prints keys.
import { describe, expect, it } from 'vitest'
import { decideIntent } from './index'

describe.skipIf(!process.env.GLANCE_LIVE)('live Fireworks call', () => {
  it('returns a parsable target', async () => {
    try { process.loadEnvFile(new URL('../../../.env', import.meta.url).pathname) } catch {}
    const elements = [
      { id: 0, role: 'link', name: 'Home', box: { x: 20, y: 20, w: 80, h: 30 } },
      { id: 1, role: 'link', name: 'Pricing', box: { x: 120, y: 20, w: 80, h: 30 } },
      { id: 2, role: 'button', name: 'Sign up', box: { x: 220, y: 20, w: 90, h: 30 } },
    ]
    for (let i = 0; i < 3; i++) {
      const r = await decideIntent({ viewport: { w: 1280, h: 800 }, gaze: { x: 150, y: 40 }, command: 'open that', elements }, { provider: process.env.GLANCE_PROVIDER as 'openai' | undefined })
      console.log('LIVE', JSON.stringify({ target: r.target, ms: r.latencyMs, raw: r.raw.slice(0, 200), err: r.error, model: r.model, provider: r.provider }))
      if (i === 2) expect(r.target).toBe(1)
    }
  }, 60_000)
})
