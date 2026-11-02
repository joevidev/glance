import { describe, expect, it, vi } from 'vitest'
import { buildPrompt } from '@glance/contracts'
import { decideIntent, nearestElement, DEFAULT_MODEL, type ChatClient } from './index'

const elements = [
  { id: 0, role: 'link', name: 'Home', box: { x: 0, y: 0, w: 100, h: 40 } },
  { id: 1, role: 'link', name: 'Pricing', box: { x: 0, y: 100, w: 100, h: 40 } },
  { id: 2, role: 'button', name: 'Sign up', box: { x: 0, y: 160, w: 100, h: 40 } },
]
const input = { viewport: { w: 1280, h: 800 }, gaze: { x: 40, y: 150 }, command: 'open that', elements }

const mock = (content: string | null) => {
  const create = vi.fn(async (_p: unknown) => ({ choices: [{ message: { content } }] }))
  return { create, client: { chat: { completions: { create } } } as unknown as ChatClient }
}

describe('decideIntent', () => {
  it('sends the shared prompt at temperature 0 and parses the target', async () => {
    const { create, client } = mock('{"target": 2}')
    const r = await decideIntent(input, { client })
    expect(r.target).toBe(2)
    expect(r.raw).toBe('{"target": 2}')
    expect(r.model).toBe(DEFAULT_MODEL)
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
    const call = create.mock.calls[0]![0] as any
    expect(call.temperature).toBe(0)
    expect(call.max_tokens).toBeLessThanOrEqual(512)
    expect(call.messages[0].content).toBe(buildPrompt(input, { withGaze: true }))
  })
  it('uses the command-only prompt when there is no gaze', async () => {
    const { create, client } = mock('{"target": 1}')
    await decideIntent({ ...input, gaze: null }, { client })
    expect((create.mock.calls[0]![0] as any).messages[0].content).not.toContain('Gaze point')
  })
  it('returns null target on garbage and on empty content', async () => {
    expect((await decideIntent(input, { client: mock('hmm').client })).target).toBeNull()
    expect((await decideIntent(input, { client: mock(null).client })).target).toBeNull()
  })
  it('never throws: API errors come back as error + null target', async () => {
    const client = { chat: { completions: { create: async () => { throw new Error('boom') } } } } as unknown as ChatClient
    const r = await decideIntent(input, { client })
    expect(r.target).toBeNull()
    expect(r.error).toBe('boom')
  })
})

describe('nearestElement', () => {
  it('picks the box nearest to the gaze point', () => {
    expect(nearestElement({ x: 40, y: 150 }, elements)).toBe(1)
    expect(nearestElement({ x: 40, y: 190 }, elements)).toBe(2)
    expect(nearestElement({ x: 0, y: 0 }, [])).toBeNull()
  })
})
