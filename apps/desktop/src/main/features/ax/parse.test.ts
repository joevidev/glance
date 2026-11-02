import { describe, expect, it } from 'vitest'
import { chooseSource, parseAxOutput, parseElement, resolveMode } from './parse'

const good = { id: 0, role: 'button', name: 'Save', box: { x: 1, y: 2, w: 30, h: 20 } }

describe('glance-ax output parsing', () => {
  it('parses a normal result and drops non-conforming elements', () => {
    const r = parseAxOutput(JSON.stringify({ ok: true, trusted: true, app: 'Finder', pid: 7, ms: 120, elements: [good, { id: -1 }, 'x', { ...good, name: 'x'.repeat(81) }] }))
    expect(r.ok).toBe(true)
    expect(r.app).toBe('Finder')
    expect(r.elements).toEqual([good])
  })
  it('reports missing Accessibility permission instead of failing silently', () => {
    const r = parseAxOutput(JSON.stringify({ ok: false, trusted: false, error: 'Accessibility permission is missing for x' }))
    expect(r.ok).toBe(false)
    expect(r.trusted).toBe(false)
    expect(r.error).toMatch(/Accessibility/)
  })
  it('handles garbage and empty output', () => {
    expect(parseAxOutput('').ok).toBe(false)
    expect(parseAxOutput('not json').error).toMatch(/no JSON/)
  })
  it('validates element shape', () => {
    expect(parseElement(good)).toEqual(good)
    expect(parseElement({ ...good, box: { x: 1 } })).toBeNull()
    expect(parseElement({ ...good, id: 1.5 })).toBeNull()
  })
})

describe('GLANCE_ELEMENTS switch', () => {
  it('defaults to auto and accepts ax|dom', () => {
    expect(resolveMode(undefined)).toBe('auto')
    expect(resolveMode('AX')).toBe('ax')
    expect(resolveMode('dom')).toBe('dom')
    expect(resolveMode('nonsense')).toBe('auto')
  })
  it('auto: Glance focused -> dom, otherwise ax; explicit modes win', () => {
    expect(chooseSource('auto', true)).toBe('dom')
    expect(chooseSource('auto', false)).toBe('ax')
    expect(chooseSource('ax', true)).toBe('ax')
    expect(chooseSource('dom', false)).toBe('dom')
  })
})
