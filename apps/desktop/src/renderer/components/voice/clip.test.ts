import { describe, expect, it } from 'vitest'
import { judgeClip, rms } from './clip'

describe('judgeClip', () => {
  it('sends a normal clip', () => expect(judgeClip({ durationMs: 1800, bytes: 9000, peak: 0.08 })).toBeNull())
  it('rejects a bounce', () => {
    expect(judgeClip({ durationMs: 150, bytes: 9000, peak: 0.08 })).toBe('too-short')
    expect(judgeClip({ durationMs: 900, bytes: 400, peak: 0.08 })).toBe('too-short')
  })
  it('rejects a silent room, but trusts the clip when the meter could not run', () => {
    expect(judgeClip({ durationMs: 3000, bytes: 9000, peak: 0.001 })).toBe('silence')
    expect(judgeClip({ durationMs: 3000, bytes: 9000, peak: null })).toBeNull()
  })
})

describe('rms', () => {
  it('measures level', () => {
    expect(rms(new Float32Array(100))).toBe(0)
    expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5)
  })
})
