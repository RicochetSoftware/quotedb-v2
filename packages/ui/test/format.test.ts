import { describe, expect, it } from 'vitest'
import { formatDate, relativeTime } from '../src/lib/format'
import { cn } from '../src/lib/utils'

describe('display helpers', () => {
  const now = Date.UTC(2026, 10, 1, 12)
  it.each([null, undefined, ''])('shows never for missing dates (%s)', (value) => {
    expect(relativeTime(value, now)).toBe('never')
  })
  it.each([-59, 0, 59])('shows just now for %s seconds', (seconds) => {
    expect(relativeTime(new Date(now + seconds * 1000).toISOString(), now)).toBe('just now')
  })
  it.each([
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2592000, 'month'],
    [31536000, 'year'],
  ] as const)('handles past and future %s-second boundaries', (seconds, unit) => {
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    for (const direction of [-1, 1]) {
      expect(relativeTime(new Date(now + direction * seconds * 1000).toISOString(), now)).toBe(
        formatter.format(direction, unit),
      )
    }
  })
  it('formats a calendar date using the current locale', () => {
    const date = new Date(2026, 10, 1, 12)
    expect(formatDate(date.toISOString())).toBe(
      new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date),
    )
  })
  it('merges conditional classes while letting callers override conflicting utilities', () => {
    expect(cn('p-2 text-sm', false, ['rounded', { hidden: false }], 'p-4')).toBe(
      'text-sm rounded p-4',
    )
    expect(cn(null, undefined, false)).toBe('')
    expect(cn('hover:bg-red-500', 'hover:bg-blue-500', 'bg-white')).toBe(
      'hover:bg-blue-500 bg-white',
    )
  })
})
