import { describe, expect, it } from 'vitest'
import { buildTransferPairStamps, getTransferDirection } from '../accountBalances'
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

    const pairStamps = buildTransferPairStamps([outbound, inbound])
    expect(getTransferDirection(outbound, pairStamps)).toBe('out')
    expect(getTransferDirection(inbound, pairStamps)).toBe('in')
  })

  it('reads the stored role for legs created in the same millisecond, whatever the ids', () => {
    const stamp = '2026-05-01T00:00:00.000Z'
    const outbound = baseTx({ _id: 'z-leg', type: 'transfer', transferPairId: 'a-leg', transferRole: 'out', createdAt: stamp })
    const inbound = baseTx({ _id: 'a-leg', type: 'transfer', transferPairId: 'z-leg', transferRole: 'in', createdAt: stamp })

    const pairStamps = buildTransferPairStamps([outbound, inbound])
    expect(getTransferDirection(outbound, pairStamps)).toBe('out')
    expect(getTransferDirection(inbound, pairStamps)).toBe('in')
  })

  it('lets a stored role win over creation order', () => {
    const outbound = baseTx({ _id: 'out-1', type: 'transfer', transferPairId: 'in-1', transferRole: 'out', createdAt: '2026-05-02T00:00:00.000Z' })
    const inbound = baseTx({ _id: 'in-1', type: 'transfer', transferPairId: 'out-1', transferRole: 'in', createdAt: '2026-05-01T00:00:00.000Z' })

    const pairStamps = buildTransferPairStamps([outbound, inbound])
    expect(getTransferDirection(outbound, pairStamps)).toBe('out')
    expect(getTransferDirection(inbound, pairStamps)).toBe('in')
  })

  it('reads a stored role even when the pair is not in the resolved set', () => {
    const inbound = baseTx({ _id: 'in-1', type: 'transfer', transferPairId: 'out-elsewhere', transferRole: 'in' })
    expect(getTransferDirection(inbound, buildTransferPairStamps([inbound]))).toBe('in')
  })

  it("takes the opposite of the pair's role when a leg has none yet", () => {
    const stamp = '2026-05-01T00:00:00.000Z'
    const legacy = baseTx({ _id: 'a-leg', type: 'transfer', transferPairId: 'b-leg', createdAt: stamp })
    const stamped = baseTx({ _id: 'b-leg', type: 'transfer', transferPairId: 'a-leg', transferRole: 'in', createdAt: stamp })

    expect(getTransferDirection(legacy, buildTransferPairStamps([legacy, stamped]))).toBe('out')
  })

  it('resolves legs created in the same millisecond to exactly one out and one in', () => {
    const stamp = '2026-05-01T00:00:00.000Z'
    const first = baseTx({ _id: 'a-leg', type: 'transfer', transferPairId: 'b-leg', createdAt: stamp })
    const second = baseTx({ _id: 'b-leg', type: 'transfer', transferPairId: 'a-leg', createdAt: stamp })

    const pairStamps = buildTransferPairStamps([first, second])
    const directions = [getTransferDirection(first, pairStamps), getTransferDirection(second, pairStamps)]
    expect(directions.sort()).toEqual(['in', 'out'])
  })

  it('returns undefined for a non-transfer transaction', () => {
    const expense = baseTx({ type: 'expense' })
    expect(getTransferDirection(expense, buildTransferPairStamps([expense]))).toBeUndefined()
  })

  it('returns undefined when the paired leg is not present in the resolved set', () => {
    const outbound = baseTx({
      _id: 'out-1',
      type: 'transfer',
      transferPairId: 'missing-leg',
    })
    expect(getTransferDirection(outbound, buildTransferPairStamps([outbound]))).toBeUndefined()
  })
})
