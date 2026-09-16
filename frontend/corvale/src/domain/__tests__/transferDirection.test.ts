import { describe, expect, it } from 'vitest'
import { buildPairCreatedAtById, getTransferDirection } from '../accountBalances'
import type { LocalTransaction } from '../types'

const baseTx = (overrides: Partial<LocalTransaction>): LocalTransaction => ({
  _id: 'tx-id',
  updatedAt: '2026-05-01T00:00:00.000Z',
  createdAt: '2026-05-01T00:00:00.000Z',
  userId: 'u1',
  accountId: 'acc-1',
  categoryId: 'cat-1',
  type: 'expense',
  status: 'posted',
  amount: 1000,
  title: 'tx',
  date: '2026-05-01',
  splitTransactionId: null,
  ...overrides,
})

describe('domain/accountBalances: getTransferDirection (BUG-35)', () => {
  it('marks the earlier-created leg as out and the later one as in', () => {
    const outbound = baseTx({
      _id: 'out-1',
      accountId: 'checking',
      type: 'transfer',
      transferPairId: 'in-1',
      createdAt: '2026-05-01T00:00:00.000Z',
    })
    const inbound = baseTx({
      _id: 'in-1',
      accountId: 'savings',
      type: 'transfer',
      transferPairId: 'out-1',
      createdAt: '2026-05-01T00:00:00.001Z',
    })

    const pairCreatedAtById = buildPairCreatedAtById([outbound, inbound])
    expect(getTransferDirection(outbound, pairCreatedAtById)).toBe('out')
    expect(getTransferDirection(inbound, pairCreatedAtById)).toBe('in')
  })

  it('returns undefined for a non-transfer transaction', () => {
    const expense = baseTx({ type: 'expense' })
    expect(getTransferDirection(expense, buildPairCreatedAtById([expense]))).toBeUndefined()
  })

  it('returns undefined when the paired leg is not present in the resolved set', () => {
    const outbound = baseTx({
      _id: 'out-1',
      type: 'transfer',
      transferPairId: 'missing-leg',
    })
    expect(getTransferDirection(outbound, buildPairCreatedAtById([outbound]))).toBeUndefined()
  })
})
