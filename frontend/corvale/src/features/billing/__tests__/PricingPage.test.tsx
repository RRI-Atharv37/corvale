import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import PricingPage from '../PricingPage'
import { fetchPublicPlans } from '../billingApi'
import { plans, renderWithUser } from './fixtures'

vi.mock('../billingApi', () => ({ fetchPublicPlans: vi.fn() }))

beforeEach(() => {
    vi.mocked(fetchPublicPlans).mockReset()
    vi.mocked(fetchPublicPlans).mockResolvedValue(plans())
})

const renderPricing = (signedIn = false) => renderWithUser(<PricingPage />, { signedIn, route: '/pricing' })

describe('PricingPage', () => {
    it('lists the plan with its monthly price first', async () => {
        renderPricing()

        expect(await screen.findByRole('heading', { name: 'Pro' })).toBeInTheDocument()
        expect(screen.getByText('$12')).toBeInTheDocument()
    })

    it('switches to annual prices and says what the discount is', async () => {
        const user = userEvent.setup()
        renderPricing()
        await screen.findByRole('heading', { name: 'Pro' })

        await user.click(screen.getByRole('radio', { name: /annual/i }))

        expect(screen.getByText('$96')).toBeInTheDocument()
        expect(screen.getByText(/save 33%/i)).toBeInTheDocument()
    })

    it('shows what the plan includes', async () => {
        renderPricing()
        await screen.findByRole('heading', { name: 'Pro' })

        const proCard = screen.getByRole('heading', { name: 'Pro' }).closest('article') as HTMLElement

        expect(proCard).toHaveTextContent('10 GB')
        expect(proCard).toHaveTextContent(/unlimited devices/i)
        expect(proCard).not.toHaveTextContent(/workspaces.*not included/i)
    })

    it('states the trial and that the data can always be exported, on every plan', async () => {
        renderPricing()
        await screen.findByRole('heading', { name: 'Pro' })

        expect(screen.getByText(/30-day free trial/i)).toBeInTheDocument()
        expect(screen.getByText(/export/i)).toBeInTheDocument()
    })

    it('sends a visitor to sign up', async () => {
        renderPricing(false)
        await screen.findByRole('heading', { name: 'Pro' })

        const links = screen.getAllByRole('link', { name: /start.*trial/i })

        expect(links.length).toBeGreaterThan(0)
        links.forEach((link) => expect(link).toHaveAttribute('href', '/signup'))
    })

    it('sends a signed-in user to their billing page instead', async () => {
        renderPricing(true)
        await screen.findByRole('heading', { name: 'Pro' })

        const links = screen.getAllByRole('link', { name: /choose|manage/i })

        links.forEach((link) => expect(link).toHaveAttribute('href', '/settings/billing'))
        expect(screen.queryByRole('link', { name: /start.*trial/i })).not.toBeInTheDocument()
    })

    it('offers nothing to buy while billing is off, and says so plainly', async () => {
        vi.mocked(fetchPublicPlans).mockResolvedValue(plans({ billingEnabled: false, plans: [] }))
        renderPricing()

        expect(await screen.findByText(/paid plans are not available/i)).toBeInTheDocument()
        expect(screen.queryByText('$12')).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /trial/i })).not.toBeInTheDocument()
    })

    it('shows an error with a retry when the plans cannot be loaded', async () => {
        vi.mocked(fetchPublicPlans).mockRejectedValueOnce(new Error('network down'))
        const user = userEvent.setup()
        renderPricing()

        const retry = await screen.findByRole('button', { name: /try again|retry/i })
        await user.click(retry)

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument())
        expect(fetchPublicPlans).toHaveBeenCalledTimes(2)
    })
})
