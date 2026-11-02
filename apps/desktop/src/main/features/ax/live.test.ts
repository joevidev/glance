// Live check, skipped unless GLANCE_LIVE=1 (OpenAI via GLANCE_PROVIDER=openai). Real AX elements of GLANCE_AX_APP (default Finder),
// gaze placed 30 px off the centre of GLANCE_AX_TARGET (an element name), command "open that". Loads .env in process; never prints keys.
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { decideIntent, nearestElement } from '@glance/brain'
import { parseAxOutput } from './parse'

describe.skipIf(!process.env.GLANCE_LIVE)('live intent over AX elements', () => {
  it('picks the element the gaze is near', async () => {
    try { process.loadEnvFile(new URL('../../../../../../.env', import.meta.url).pathname) } catch {}
    const app = process.env.GLANCE_AX_APP ?? 'Finder'
    const pid = execFileSync('pgrep', ['-x', app]).toString().trim().split('\n')[0] ?? ''
    const bin = new URL('../../../../../../packages/ax/bin/glance-ax', import.meta.url).pathname
    const ax = parseAxOutput(execFileSync(bin, ['elements', '--pid', pid]).toString())
    expect(ax.ok).toBe(true)
    const target = ax.elements.find((e) => e.name === (process.env.GLANCE_AX_TARGET ?? 'Documents'))
    expect(target).toBeTruthy()
    const gaze = { x: target!.box.x + target!.box.w / 2 + 30, y: target!.box.y + target!.box.h / 2 + 4 }
    const r = await decideIntent({ viewport: { w: 1710, h: 1107 }, gaze, command: 'open that', elements: ax.elements }, { provider: process.env.GLANCE_PROVIDER as 'openai' | undefined })
    console.log('LIVE-AX', JSON.stringify({ app, count: ax.elements.length, target: target!.id, nearest: nearestElement(gaze, ax.elements), picked: r.target, ms: r.latencyMs, model: r.model, err: r.error }))
    expect(r.target).toBe(target!.id)
  }, 60_000)
})
