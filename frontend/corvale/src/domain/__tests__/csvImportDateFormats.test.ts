import { describe, expect, it } from 'vitest'
import { mapCsvRows, type ImportDateFormat } from '@shared/csvImport'

/**
 * BUG-18 — day-first CSV dates. Client-side parity check for the `dateFormat` control on the
 * column mapping (`auto` | `YMD` | `MDY` | `DMY`). Mirrors
 * `backend/tests/importDateFormats.test.ts`.
 */

const HEADERS = ['Date', 'Description', 'Amount']
const map = (rows: string[][], dateFormat?: ImportDateFormat) =>
  mapCsvRows(HEADERS, rows, {
    date: 'Date',
    description: 'Description',
    amount: 'Amount',
    ...(dateFormat ? { dateFormat } : {}),
  })

describe('shared/csvImport date formats (BUG-18)', () => {
  it('reads ISO dates unchanged for every dateFormat', () => {
    for (const fmt of [undefined, 'auto', 'MDY', 'DMY', 'YMD'] as const) {
      const { rows, errors } = map([['2026-03-07', 'ISO', '-10.00']], fmt)
      expect(errors).toHaveLength(0)
      expect(rows[0].date).toBe('2026-03-07')
    }
  })

  it('keeps US month-first as the default for an all-ambiguous column', () => {
    const { rows, errors } = map([['03/07/2026', 'Ambiguous', '-10.00']])
    expect(errors).toHaveLength(0)
    expect(rows[0].date).toBe('2026-03-07')
  })

  it('auto-detects day-first from a first token > 12', () => {
    const { rows, errors } = map([
      ['12/06/2026', 'Six June', '-10.00'],
      ['25/12/2026', 'Christmas', '-20.00'],
    ])
    expect(errors).toHaveLength(0)
    expect(rows[0].date).toBe('2026-06-12')
    expect(rows[1].date).toBe('2026-12-25')
  })

  it('auto-detects month-first from a second token > 12', () => {
    const { rows, errors } = map([['03/25/2026', 'Late March', '-10.00']])
    expect(errors).toHaveLength(0)
    expect(rows[0].date).toBe('2026-03-25')
  })

  it('honours explicit DMY / MDY / YMD', () => {
    expect(map([['03/07/2026', 'x', '-1.00']], 'DMY').rows[0].date).toBe('2026-07-03')
    expect(map([['03/07/2026', 'x', '-1.00']], 'MDY').rows[0].date).toBe('2026-03-07')
    expect(map([['2026/03/07', 'x', '-1.00']], 'YMD').rows[0].date).toBe('2026-03-07')
  })

  it('accepts "." and "-" separators', () => {
    expect(map([['25.12.2026', 'x', '-1.00']]).rows[0].date).toBe('2026-12-25')
    expect(map([['25-12-2026', 'x', '-1.00']]).rows[0].date).toBe('2026-12-25')
  })

  it('rejects an out-of-range date instead of rolling it forward', () => {
    const { rows, errors } = map([['25/12/2026', 'Christmas', '-20.00']], 'MDY')
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/date/i)
  })

  it('rejects an impossible day (Feb 30)', () => {
    const { rows, errors } = map([['02/30/2026', 'x', '-1.00']], 'MDY')
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })
})
