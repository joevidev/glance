import { describe, expect, it } from 'vitest'
import { isNonCommand, normalizeCommand } from './normalize'

describe('normalizeCommand', () => {
  it('trims, lowercases and drops edge punctuation', () => {
    expect(normalizeCommand('  Open that.  ')).toBe('open that')
    expect(normalizeCommand('“Click the second link!”')).toBe('click the second link')
  })
  it('drops fillers and please, keeps meaning words', () => {
    expect(normalizeCommand('Um, open that, please')).toBe('open that')
    expect(normalizeCommand('uh... uhh the invoice')).toBe('the invoice')
    expect(normalizeCommand('Reply yes, tomorrow at three works')).toBe('reply yes tomorrow at three works')
    expect(normalizeCommand('like that one, this one')).toBe('like that one this one')
  })
  it('keeps apostrophes, digits and times', () => {
    expect(normalizeCommand("Don't send it")).toBe("don't send it")
    expect(normalizeCommand('Reply yes tomorrow at 3:30 works.')).toBe('reply yes tomorrow at 3:30 works')
    expect(normalizeCommand('open #4821')).toBe('open #4821')
  })
  it('empty and punctuation-only inputs become empty', () => {
    expect(normalizeCommand('')).toBe('')
    expect(normalizeCommand(' ... ')).toBe('')
    expect(normalizeCommand('Um.')).toBe('')
  })
})

describe('isNonCommand', () => {
  const prompt = ['open that', 'click this one', 'go to pricing']
  it('flags empty, silence hallucinations and the echoed prompt', () => {
    expect(isNonCommand('')).toBe(true)
    expect(isNonCommand(' . ')).toBe(true)
    expect(isNonCommand('Thank you.')).toBe(true)
    expect(isNonCommand('A short spoken command to control a computer, for example: open that, click this one, go to pricing.', prompt)).toBe(true)
  })
  it('lets real commands through, even ones that appear in the prompt', () => {
    for (const c of ['Open that.', 'click this one', 'Go to pricing', 'schedule it', 'the invoice']) expect(isNonCommand(c, prompt)).toBe(false)
  })
})
