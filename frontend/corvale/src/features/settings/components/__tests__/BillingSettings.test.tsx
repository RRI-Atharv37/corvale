import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import BillingSettings from '../BillingSettings'
import { LAPSED, daysFromNow, renderWithUser, snapshot } from '@features/billing/__tests__/fixtures'

describe('BillingSettings', () => {
    it('renders nothing while billing is off, so self-hosted installs see no billing at all', () => {
        const { container } = renderWithUser(<BillingSettings />, { entitlements: snapshot({ billingEnabled: false }) })

        expect(container).toBeEmptyDOMElement()
    })

    it('renders nothing for a user record with no entitlement snapshot', () => {
        const { container } = renderWithUser(<BillingSettings />, { entitlements: undefined })

        expect(container).toBeEmptyDOMElement()
    })

    it('links to the billing page and names the current plan', () => {
        renderWithUser(<BillingSettings />, { entitlements: snapshot({ planCode: 'pro', status: 'active' }) })

        const link = screen.getByRole('link', { name: /billing/i })
        expect(link).toHaveAttribute('href', '/settings/billing')
        expect(link).toHaveTextContent(/pro/i)
    })

    it('summarises a trial by its days left', () => {
        renderWithUser(<BillingSettings />, {
            entitlements: snapshot({ status: 'trialing', trialEndsAt: daysFromNow(9), currentPeriodEnd: null }),
        })

        expect(screen.getByRole('link', { name: /billing/i })).toHaveTextContent(/10 days left/i)
    })

    it('flags a lapsed account so the link is not missed', () => {
        renderWithUser(<BillingSettings />, { entitlements: snapshot({ status: 'trial_expired', ...LAPSED }) })

        expect(screen.getByRole('link', { name: /billing/i })).toHaveTextContent(/read-only/i)
    })

    it('tells the host to close the settings dialog when the link is followed', async () => {
        const onNavigate = vi.fn()
        const user = userEvent.setup()
        renderWithUser(<BillingSettings onNavigate={onNavigate} />, { entitlements: snapshot() })

        await user.click(screen.getByRole('link', { name: /billing/i }))

        expect(onNavigate).toHaveBeenCalledTimes(1)
    })
})
