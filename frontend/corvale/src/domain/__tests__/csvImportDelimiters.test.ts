import { describe, expect, it } from 'vitest'
import { sniffDelimiter, parseCsvContent } from '@shared/csvImport'
import { parseLocalImportFile } from '../importTransactions'

/**
 * BUG-19 — a semicolon / tab / pipe delimited CSV (the default Excel export outside the US)
 * must parse into real columns, not collapse into one field. Mirrors
 * `backend/tests/importDelimiters.test.ts`.
 */
describe('shared/csvImport: delimiter detection (BUG-19)', () => {
  it('sniffDelimiter picks the highest-count candidate, comma breaking ties', () => {
    expect(sniffDelimiter('Date;Description;Amount')).toBe(';')
    expect(sniffDelimiter('Date\tDescription\tAmount')).toBe('\t')
    expect(sniffDelimiter('Date|Description|Amount')).toBe('|')
    expect(sniffDelimiter('Date,Description,Amount')).toBe(',')
    expect(sniffDelimiter('a,b;c\td|e')).toBe(',')
  })

  it('parseCsvContent auto-detects a semicolon file', () => {
    const { headers, rows, delimiter } = parseCsvContent(
      ['Date;Description;Amount', '2026-01-05;Kaufland;-12,50'].join('\n')
    )
    expect(delimiter).toBe(';')
    expect(headers).toEqual(['Date', 'Description', 'Amount'])
    expect(rows[0]).toEqual(['2026-01-05', 'Kaufland', '-12,50'])
  })

  it('parseCsvContent honours an explicit override', () => {
    const { headers } = parseCsvContent('Date;Payee, Inc.;Amount\n2026-01-05;ACME, Inc.;-5', ';')
    expect(headers).toEqual(['Date', 'Payee, Inc.', 'Amount'])
  })

  it('parseLocalImportFile reports the sniffed delimiter and re-parses on override', async () => {
    const csv = ['Date;Description;Amount', '2026-01-05;Grocery;-45,50'].join('\n')
    const file = new File([csv], 'euro.csv', { type: 'text/csv' })

    const auto = await parseLocalImportFile(file)
    expect(auto.delimiter).toBe(';')
    expect(auto.headers).toEqual(['Date', 'Description', 'Amount'])

    const forced = await parseLocalImportFile(file, ',')
    expect(forced.delimiter).toBe(',')
    expect(forced.headers).toEqual(['Date;Description;Amount'])
  })
})
