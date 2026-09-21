import { describe, expect, it } from 'vitest'

import { formatBytes, formatDate, formatDateTime, formatLimit, groupSecret, relativeDays } from '../format'

describe('format', () => {
  it('shows dates in UTC and says so', () => {
    expect(formatDate('2026-09-21T23:30:00.000Z')).toBe('2026-09-21')
    expect(formatDateTime('2026-09-21T23:30:00.000Z')).toBe('2026-09-21 23:30 UTC')
  })

  it('renders a missing date as a dash', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDateTime(undefined)).toBe('-')
  })

  it('formats bytes and limits, with null as unlimited', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatLimit(null, formatBytes)).toBe('Unlimited')
    expect(formatLimit(1024, formatBytes)).toBe('1.0 KB')
  })

  it('describes a distance in whole days', () => {
    const now = new Date('2026-09-21T12:00:00.000Z')

    expect(relativeDays('2026-09-26T12:00:00.000Z', now)).toBe('in 5 days')
    expect(relativeDays('2026-09-20T12:00:00.000Z', now)).toBe('1 day ago')
    expect(relativeDays('2026-09-21T13:00:00.000Z', now)).toBe('today')
    expect(relativeDays(null, now)).toBe('-')
  })

  it('groups an authenticator secret in fours', () => {
    expect(groupSecret('ABCDEFGHIJKLMNOP')).toBe('ABCD EFGH IJKL MNOP')
  })
})
