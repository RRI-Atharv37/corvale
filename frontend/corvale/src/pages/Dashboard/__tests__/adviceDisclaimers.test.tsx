import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen } from '../../../test/test-utils'
import { API_PATHS } from '../../../utils/apiPaths'
import axiosInstance from '../../../utils/axiosInstance'
import type { User } from '../../../types/api'
import Forecast from '../Forecast'
import DebtPayoff from '../DebtPayoff'
import Subscriptions from '../Subscriptions'

// V2: the pages whose core output reads as a prediction or as advice carry a standing, non-dismissible
// note. Forecast / DebtPayoff / Subscriptions have no other test harness, so this file only pins that
// the note is present and says the right thing - the header renders before any data loads.

vi.mock('../../../utils/axiosInstance', () => ({
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
