import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildPrompt, completion, parseDecision, pyRound, renderElements } from './prompt'
import { CaseSchema } from './types'

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/prompt_golden.json', import.meta.url)), 'utf8'),
)

describe('prompt twin of glance_lab/prompt.py', () => {
  it('golden case validates against the zod schema', () => {
    expect(CaseSchema.safeParse(golden.case).success).toBe(true)
  })
  it('with gaze matches the golden byte for byte', () => {
    expect(buildPrompt(golden.case, { withGaze: true })).toBe(golden.prompt_with_gaze)
  })
  it('command only matches the golden byte for byte', () => {
    expect(buildPrompt(golden.case, { withGaze: false })).toBe(golden.prompt_command_only)
  })
  it('completion matches the golden', () => {
    expect(completion(golden.case.answer)).toBe(golden.completion)
  })
  it('pyRound is half to even like Python', () => {
    expect([0.5, 1.5, 2.5, 300.5, -0.5, -1.5, 812.4, 430.6].map(pyRound)).toEqual([0, 2, 2, 300, 0, -2, 812, 431])
  })
  it('does not expand $-patterns in the command and replaces every token', () => {
    const p = buildPrompt({ ...golden.case, command: "open $& and $' {{width}}" })
    expect(p).toContain(`Command: "open $& and $' {{width}}"`)
  })
  it('parseDecision', () => {
    expect(parseDecision('{"target": 15}')).toBe(15)
    expect(parseDecision('```json\n{"target":3}\n```')).toBe(3)
    expect(parseDecision('{"target": null}')).toBeNull()
    expect(parseDecision('nope')).toBeNull()
    expect(parseDecision(undefined)).toBeNull()
  })
  it('renderElements collapses whitespace and swaps quotes', () => {
    expect(renderElements(golden.case.elements)).toContain(`[15] link "Re: 'Invoice' #4821" @100,380,600,48`)
  })
})
