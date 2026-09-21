import React from 'react'
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import BillingBanner from '../components/BillingBanner'
import { LAPSED, daysFromNow, renderWithUser, snapshot } from './fixtures'

const renderBanner = (entitlements: ReturnType<typeof snapshot> | undefined, route = '/dashboard') =>
    renderWithUser(<BillingBanner />, { entitlements, route })

describe('BillingBanner', () => {
    it('is absent for a healthy subscription', () => {
        const { container } = renderBanner(snapshot())

        expect(container).toBeEmptyDOMElement()
    })

    it('is absent while billing is off', () => {
        const { container } = renderBanner(snapshot({ billingEnabled: false, status: 'none', ...LAPSED }))

        expect(container).toBeEmptyDOMElement()
    })

    it('is absent for a user record with no entitlement snapshot (an old cache), rather than nagging', () => {
        const { container } = renderBanner(undefined)

        expect(container).toBeEmptyDOMElement()
    })

    it('stays quiet for most of a trial and only counts down in the last week', () => {
        const early = renderBanner(snapshot({ status: 'trialing', trialEndsAt: daysFromNow(20), currentPeriodEnd: null }))
        expect(early.container).toBeEmptyDOMElement()
        early.unmount()

        renderBanner(snapshot({ status: 'trialing', trialEndsAt: daysFromNow(4), currentPeriodEnd: null }))
        expect(screen.getByRole('status')).toHaveTextContent(/5 days left/i)
    })

    it('links every notice to the billing page', () => {
        renderBanner(snapshot({ status: 'trialing', trialEndsAt: daysFromNow(2), currentPeriodEnd: null }))

        expect(screen.getByRole('link', { name: /choose a plan/i })).toHaveAttribute('href', '/settings/billing')
    })

    it('an expired trial announces itself as read-only and reassures the data is kept', () => {
        renderBanner(snapshot({ status: 'trial_expired', ...LAPSED, trialEndsAt: daysFromNow(-2) }))

        const notice = screen.getByRole('alert')
        expect(notice).toHaveTextContent(/trial has ended/i)
        expect(notice).toHaveTextContent(/read-only/i)
    })

    it('a failed payment asks for the card to be updated', () => {
        renderBanner(snapshot({ status: 'past_due', graceEndsAt: daysFromNow(3) }))

        expect(screen.getByRole('link', { name: /update payment/i })).toHaveAttribute('href', '/settings/billing')
    })

    it('a subscription set to end says so', () => {
        renderBanner(snapshot({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: daysFromNow(9) }))

        expect(screen.getByRole('status')).toHaveTextContent(/ends on/i)
        expect(screen.getByRole('link', { name: /resume/i })).toBeInTheDocument()
    })

    it('a cancelled subscription offers to resubscribe', () => {
        renderBanner(snapshot({ status: 'cancelled', ...LAPSED }))

        expect(screen.getByRole('link', { name: /resubscribe/i })).toHaveAttribute('href', '/settings/billing')
    })

    it('does not repeat itself on the billing page, which shows the same notice in full', () => {
        const { container } = renderBanner(snapshot({ status: 'trial_expired', ...LAPSED }), '/settings/billing')

        expect(container).toBeEmptyDOMElement()
    })
})
