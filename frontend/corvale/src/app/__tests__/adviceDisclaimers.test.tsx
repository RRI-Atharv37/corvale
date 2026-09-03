import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen } from '@/test/test-utils'
import { API_PATHS } from '@lib/apiPaths'
import axiosInstance from '@lib/axiosInstance'
import type { User } from '@lib/types/api'
import Forecast from '@features/forecast/ForecastPage'
import DebtPayoff from '@features/debts/DebtPayoffPage'
import Subscriptions from '@features/subscriptions/SubscriptionsPage'
import Saver from '@features/saver/SaverPage'
import Pushover from '@features/saver/PushoverPage'

// V2 / V3: the pages whose core output reads as a prediction or as advice (V2), and the saver /
// pushover pages that are easy to misread as real money movement (V3), carry a standing,
// non-dismissible note. None of these pages have another test harness, so this file only pins that
// the note is present and says the right thing - the header renders before any data loads.

vi.mock('@lib/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}))

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    preferredCurrency: 'USD',
    timezone: 'UTC',
}

beforeEach(() => {
    vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
        if (url === API_PATHS.AUTH.REFRESH) {
            return { success: true, data: { token: 'test-token', user: mockUser } }
        }
        return { success: true, data: [] }
    })
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
})

describe('advice / prediction disclaimers (V2)', () => {
    it('Forecast frames projected balances as estimates', async () => {
        renderWithProviders(<Forecast />, { route: '/forecast' })

        const note = await screen.findByRole('note')
        expect(note).toHaveTextContent(/projected balances are estimates/i)
    })

    it('DebtPayoff says plainly it is not financial advice, in the caution tone', async () => {
        renderWithProviders(<DebtPayoff />, { route: '/debts' })

        const note = await screen.findByRole('note')
        expect(note).toHaveTextContent(/not financial advice/i)
        expect(note.className).toMatch(/warning/)
    })

    it('Subscriptions says the list is inferred from patterns', async () => {
        renderWithProviders(<Subscriptions />, { route: '/subscriptions' })

        const note = await screen.findByRole('note')
        expect(note).toHaveTextContent(/inferred from recurring transaction patterns/i)
    })
})

describe('saver / pushover mechanics disclaimers (V3)', () => {
    it('Saver says adding to it moves no money and leaves the bank account untouched', async () => {
        renderWithProviders(<Saver />, { route: '/saver' })

        const note = await screen.findByRole('note')
        expect(note).toHaveTextContent(/moves no money and creates no transaction/i)
        expect(note).toHaveTextContent(/bank account is untouched/i)
    })

    it('Pushover says the rollover returns the amount to displayed spendable, not the bank', async () => {
        renderWithProviders(<Pushover />, { route: '/pushover' })

        const note = await screen.findByRole('note')
        expect(note).toHaveTextContent(/returns that amount to your displayed spendable balance/i)
        expect(note).toHaveTextContent(/nothing enters or leaves your bank account/i)
    })
})
