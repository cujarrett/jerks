import { ago } from './charts'

describe('ago', () => {
  it('reads like a person would say it', () => {
    expect(ago(2_000)).toBe('just now')
    expect(ago(14_000)).toBe('14s ago')
    expect(ago(3 * 60_000)).toBe('3 min ago')
    expect(ago(5 * 3_600_000)).toBe('5 h ago')
    expect(ago(2 * 86_400_000)).toBe('2 d ago')
  })
})
