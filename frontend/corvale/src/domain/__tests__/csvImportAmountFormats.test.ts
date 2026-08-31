import { describe, expect, it } from 'vitest'
import { mapCsvRows } from '@shared/csvImport'

/**
 * BUG-20 — locale-formatted CSV amounts. Client-side parity check for the shared
 * `parseImportAmount` helper (non-`$` symbols, decimal-comma inference, grouped digits).
 * Mirrors `backend/tests/importAmountFormats.test.ts`.
 */

const HEADERS = ['Date', 'Description', 'Amount']

const mapAmounts = (amountCells: string[]) =>
  mapCsvRows(
    HEADERS,
    amountCells.map((amount, index) => [
      `2026-01-${String(index + 1).padStart(2, '0')}`,
      `Row ${index}`,
      amount,
    ]),
    { date: 'Date', description: 'Description', amount: 'Amount' }
  )

describe('shared/csvImport amount formats (BUG-20)', () => {
  it('keeps US $ / comma / parens parsing unchanged', () => {
    const { rows, errors } = mapAmounts(['$1,250.00', '-$40.00', '(40.00)'])
    expect(errors).toHaveLength(0)
    expect(rows[0]).toMatchObject({ amount: 1250, type: 'income' })
    expect(rows[1]).toMatchObject({ amount: 40, type: 'expense' })
    expect(rows[2]).toMatchObject({ amount: 40, type: 'expense' })
  })

  it('reads European decimal-comma amounts at the right magnitude', () => {
    const { rows, errors } = mapAmounts(['1.234,56', '1 234,56', '1.234.567,89'])
    expect(errors).toHaveLength(0)
    expect(rows[0].amount).toBeCloseTo(1234.56, 2)
    expect(rows[1].amount).toBeCloseTo(1234.56, 2)
    expect(rows[2].amount).toBeCloseTo(1234567.89, 2)
  })

  it('reads Indian-grouped amounts', () => {
    const { rows, errors } = mapAmounts(['1,00,000.00'])
    expect(errors).toHaveLength(0)
    expect(rows[0].amount).toBe(100000)
  })

  it('accepts non-dollar symbols and ISO codes', () => {
    const { rows, errors } = mapAmounts(['€40.00', '£40.00', '₹40.00', '¥40', 'INR 500', '500 INR'])
    expect(errors).toHaveLength(0)
    expect(rows.map((row) => row.amount)).toEqual([40, 40, 40, 40, 500, 500])
  })

  it('distinguishes a decimal comma from a thousands comma by trailing digit count', () => {
    expect(mapAmounts(['40,00']).rows[0].amount).toBe(40)
    expect(mapAmounts(['40,5']).rows[0].amount).toBeCloseTo(40.5, 2)
    expect(mapAmounts(['1,250']).rows[0].amount).toBe(1250)
  })

  it('rejects an unparseable or ambiguous value as a row error', () => {
    const { rows, errors } = mapAmounts(['not money', '1.2.3'])
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(2)
  })

  it('applies the same parsing to debit/credit columns', () => {
    const { rows, errors } = mapCsvRows(
      ['Date', 'Description', 'Debit', 'Credit'],
      [
        ['2026-01-05', 'Groceries', '1.234,56', ''],
        ['2026-01-06', 'Salary', '', '2.000,00'],
      ],
      { date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit' }
    )
    expect(errors).toHaveLength(0)
    expect(rows[0]).toMatchObject({ type: 'expense' })
    expect(rows[0].amount).toBeCloseTo(1234.56, 2)
    expect(rows[1]).toMatchObject({ type: 'income' })
    expect(rows[1].amount).toBe(2000)
  })
})
