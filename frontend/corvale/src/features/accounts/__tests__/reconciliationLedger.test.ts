import { describe, it, expect, vi, beforeEach } from 'vitest'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import type { Account } from '@features/accounts/types'
import type { Transaction } from '@features/transactions/types'
import { computeClearedDelta, fetchUnreconciledTransactions } from '../reconciliationLedger'

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn() },
}))

const tx = (overrides: Partial<Transaction>): Transaction => ({
    _id: 't1',
    userId: 'u1',
    accountId: 'a1',
    categoryId: 'c1',
    type: 'expense',
    status: 'posted',
    amount: 10,
    currency: 'USD',
    title: 'Row',
    date: '2026-01-10T00:00:00.000Z',
    clearedStatus: 'cleared',
    ...overrides,
})

const account = (overrides: Partial<Account> = {}): Account => ({
    _id: 'a1',
    userId: 'u1',
    name: 'Account',
    type: 'checking',
    currency: 'USD',
    openingBalance: 0,
    currentBalance: 0,
    isDefault: false,
    isArchived: false,
    ...overrides,
})

describe('computeClearedDelta (BUG-76)', () => {
    it('signs income, expense and both transfer directions on a checking account', () => {
        const rows = [
            tx({ _id: '1', type: 'income', amount: 50 }),
            tx({ _id: '2', type: 'expense', amount: 20 }),
            tx({ _id: '3', type: 'transfer', amount: 10, transferDirection: 'out' }),
            tx({ _id: '4', type: 'transfer', amount: 5, transferDirection: 'in' }),
        ]

        expect(computeClearedDelta(rows, 'checking')).toBe(25)
    })

    it('inverts the signs on a credit card, so a payment lowers what is owed', () => {
        const rows = [
            tx({ _id: '1', type: 'expense', amount: 100 }),
            tx({ _id: '2', type: 'transfer', amount: 300, transferDirection: 'in' }),
        ]

        expect(computeClearedDelta(rows, 'credit')).toBe(-200)
    })

    it('counts only cleared rows, not pending ones', () => {
        const rows = [
            tx({ _id: '1', type: 'expense', amount: 20, clearedStatus: 'cleared' }),
            tx({ _id: '2', type: 'expense', amount: 99, clearedStatus: 'pending' }),
        ]

        expect(computeClearedDelta(rows, 'checking')).toBe(-20)
    })

    it('treats a transfer leg with no resolved direction as an outflow', () => {
        expect(computeClearedDelta([tx({ type: 'transfer', amount: 7 })], 'checking')).toBe(-7)
    })

    it('does not drift on repeated decimals', () => {
        const rows = [0.1, 0.2, 0.3].map((amount, index) => tx({ _id: String(index), type: 'income', amount }))

        expect(computeClearedDelta(rows, 'checking')).toBe(0.6)
    })
})

describe('fetchUnreconciledTransactions (BUG-76)', () => {
    beforeEach(() => {
        vi.mocked(axiosInstance.get).mockReset()
    })

    const page = (rows: Transaction[], pageNumber: number, totalPages: number) => ({
        success: true,
        data: { data: rows, meta: { pageNumber, totalPages, totalTransactions: rows.length } },
    })

    it('asks the server for unreconciled, posted rows instead of filtering a page client-side', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce(page([tx({})], 1, 1))

        await fetchUnreconciledTransactions(account())

        expect(axiosInstance.get).toHaveBeenCalledWith(
            API_PATHS.TRANSACTIONS.GET_ALL,
            expect.objectContaining({
                params: expect.objectContaining({
                    accountId: 'a1',
                    clearedStatus: 'pending,cleared',
                    status: 'posted',
                    sortBy: 'date',
                    sortOrder: 'asc',
                    page: 1,
                }),
            })
        )
    })

    it('sends the account\'s workspace so a shared account lists its rows', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce(page([tx({})], 1, 1))

        await fetchUnreconciledTransactions(account({ workspaceId: 'w1' }))

        const params = vi.mocked(axiosInstance.get).mock.calls[0][1]?.params
        expect(params.workspaceId).toBe('w1')
    })

    it('omits workspaceId for a personal account', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce(page([tx({})], 1, 1))

        await fetchUnreconciledTransactions(account({ workspaceId: null }))

        const params = vi.mocked(axiosInstance.get).mock.calls[0][1]?.params
        expect(params).not.toHaveProperty('workspaceId')
    })

    it('walks every page, so more unreconciled rows than one page still all load', async () => {
        vi.mocked(axiosInstance.get)
            .mockResolvedValueOnce(page([tx({ _id: 'a' })], 1, 3))
            .mockResolvedValueOnce(page([tx({ _id: 'b' })], 2, 3))
            .mockResolvedValueOnce(page([tx({ _id: 'c' })], 3, 3))

        const rows = await fetchUnreconciledTransactions(account())

        expect(rows.map((row) => row._id)).toEqual(['a', 'b', 'c'])
        expect(axiosInstance.get).toHaveBeenCalledTimes(3)
    })

    it('surfaces a readable error when a request fails', async () => {
        vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('Network Error'))

        await expect(fetchUnreconciledTransactions(account())).rejects.toThrow()
    })
})
