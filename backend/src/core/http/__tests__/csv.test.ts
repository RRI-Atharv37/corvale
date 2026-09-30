import { describe, it, expect } from 'vitest'
import { buildCsvRow } from '@core/http/csv'
import { buildCsvRow as transactionsBuildCsvRow, escapeCsvValue } from '@modules/transactions/transactionUtils'

describe('core/http/csv buildCsvRow (SEC-86)', () => {
    it.each(['=cmd|calc', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx'])(
        'neutralises a leading formula character in %j',
        (payload) => {
            const row = buildCsvRow(['ok', payload])
            expect(row.split(',')[1].replace(/^"/, '').startsWith("'")).toBe(true)
        }
    )

    it('neutralises a formula after an embedded newline', () => {
        expect(buildCsvRow(['legit\n=cmd|calc'])).toBe(`"legit\n'=cmd|calc"`)
    })

    it('leaves plain values and quotes RFC 4180 specials', () => {
        expect(buildCsvRow(['2026-01', 'pro', 499, 'INR'])).toBe('2026-01,pro,499,INR')
        expect(buildCsvRow(['a,b', 'a"b'])).toBe('"a,b","a""b"')
    })

    it('does not neutralise a formula character that is not leading', () => {
        expect(buildCsvRow(['Rent=Utilities'])).toBe('Rent=Utilities')
    })

    it('is the single implementation the transactions export uses', () => {
        const row = ['=1+1', 'a,b', 'plain']
        expect(transactionsBuildCsvRow(row)).toBe(buildCsvRow(row))
        expect(escapeCsvValue('=1+1')).toBe("'=1+1")
    })
})
