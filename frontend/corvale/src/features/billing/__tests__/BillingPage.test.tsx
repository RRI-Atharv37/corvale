import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import toast from 'react-hot-toast'

import BillingPage from '../BillingPage'
import * as api from '../billingApi'
import { openExternalUrl } from '@lib/openExternal'
import { LAPSED, daysFromNow, device, overview, plans, renderWithUser, snapshot } from './fixtures'

vi.mock('../billingApi', () => ({
    fetchPublicPlans: vi.fn(),
    fetchBillingOverview: vi.fn(),
    fetchInvoices: vi.fn(),
    fetchDevices: vi.fn(),
    revokeDevice: vi.fn(),
    renameDevice: vi.fn(),
    startCheckout: vi.fn(),
    openBillingPortal: vi.fn(),
    requestPlanChange: vi.fn(),
    requestCancellation: vi.fn(),
    requestResume: vi.fn(),
    fetchCurrentUser: vi.fn(),
}))
vi.mock('@lib/openExternal', () => ({ openExternalUrl: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

const invoice = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    issuedAt: '2026-04-01T12:00:00.000Z',
    total: 1200,
    currency: 'USD',
    status: 'paid',
    url: `https://pay.example/invoice/${id}`,
    ...overrides,
})

const renderBilling = (entitlements = snapshot()) => renderWithUser(<BillingPage />, { entitlements, route: '/settings/billing' })

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.fetchPublicPlans).mockResolvedValue(plans())
    vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview())
    vi.mocked(api.fetchInvoices).mockResolvedValue([])
    vi.mocked(api.fetchDevices).mockResolvedValue({ devices: [], limit: null })
    vi.mocked(api.revokeDevice).mockResolvedValue(undefined)
    vi.mocked(api.renameDevice).mockResolvedValue(undefined)
    vi.mocked(api.startCheckout).mockResolvedValue('https://pay.example/checkout')
    vi.mocked(api.openBillingPortal).mockResolvedValue('https://pay.example/portal')
    vi.mocked(api.requestPlanChange).mockResolvedValue(undefined)
    vi.mocked(api.requestCancellation).mockResolvedValue(undefined)
    vi.mocked(api.requestResume).mockResolvedValue(undefined)
    vi.mocked(api.fetchCurrentUser).mockResolvedValue({ _id: 'u1', fullName: 'Jamie Rivera', email: 'jamie@example.com', entitlements: snapshot() })
})

describe('current plan', () => {
    it('names the plan and its renewal date', async () => {
        renderBilling(snapshot({ planCode: 'pro', status: 'active', currentPeriodEnd: daysFromNow(20) }))

        const summary = await screen.findByRole('region', { name: /current plan/i })
        expect(summary).toHaveTextContent('Pro')
        expect(summary).toHaveTextContent(/active/i)
        expect(summary).toHaveTextContent(/renews on/i)
    })

    it('counts down a trial and says no card is on file', async () => {
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ hasBillingCustomer: false, hasLiveSubscription: false }))
        renderBilling(snapshot({ status: 'trialing', planCode: 'pro', trialEndsAt: daysFromNow(9), currentPeriodEnd: null }))

        expect(await screen.findByText(/10 days left/i)).toBeInTheDocument()
        expect(screen.getByText(/no card is on file/i)).toBeInTheDocument()
    })

    it('an expired trial is read-only, states that the data is kept, and offers the plans', async () => {
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ hasBillingCustomer: false, hasLiveSubscription: false }))
        renderBilling(snapshot({ status: 'trial_expired', ...LAPSED, trialEndsAt: daysFromNow(-3), currentPeriodEnd: null }))

        expect(await screen.findByRole('alert')).toHaveTextContent(/trial has ended/i)
        expect(screen.getByRole('button', { name: /^subscribe/i })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /cancel subscription/i })).not.toBeInTheDocument()
    })

    it('says a payment failed and points to the card', async () => {
        renderBilling(snapshot({ status: 'past_due', graceEndsAt: daysFromNow(4) }))

        expect(await screen.findByText(/last payment failed/i)).toBeInTheDocument()
    })

    it('offers nothing to buy while billing is off', async () => {
        vi.mocked(api.fetchPublicPlans).mockResolvedValue(plans({ billingEnabled: false, plans: [] }))
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ billingEnabled: false, hasBillingCustomer: false, hasLiveSubscription: false }))
        renderBilling(snapshot({ billingEnabled: false }))

        expect(await screen.findByText(/billing is not enabled/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /subscribe|change plan|cancel/i })).not.toBeInTheDocument()
    })

    it('reminds the user that export is free in every state', async () => {
        renderBilling(snapshot({ status: 'cancelled', ...LAPSED }))

        expect(await screen.findByText(/export your data at any time/i)).toBeInTheDocument()
    })
})

describe('choosing a plan without a live subscription', () => {
    beforeEach(() => {
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ hasBillingCustomer: false, hasLiveSubscription: false }))
    })

    it('starts a hosted checkout for the chosen plan and interval and opens it', async () => {
        const user = userEvent.setup()
        renderBilling(snapshot({ status: 'trialing', trialEndsAt: daysFromNow(9), currentPeriodEnd: null }))
        await screen.findByRole('radio', { name: /^pro/i })

        await user.click(screen.getByRole('radio', { name: /annual/i }))
        await user.click(screen.getByRole('button', { name: /^subscribe/i }))

        await waitFor(() => expect(api.startCheckout).toHaveBeenCalledWith({ planCode: 'pro', interval: 'annual' }))
        expect(openExternalUrl).toHaveBeenCalledWith('https://pay.example/checkout')
        expect(api.requestPlanChange).not.toHaveBeenCalled()
    })

    it('tells the user the plan applies once payment is confirmed, never before', async () => {
        const trial = snapshot({ status: 'trialing', trialEndsAt: daysFromNow(9), currentPeriodEnd: null })
        // The server still reports the trial: the payment has not been confirmed yet.
        vi.mocked(api.fetchCurrentUser).mockResolvedValue({ _id: 'u1', fullName: 'Jamie Rivera', email: 'jamie@example.com', entitlements: trial })
        const user = userEvent.setup()
        renderBilling(trial)
        await screen.findByRole('radio', { name: /^pro/i })

        await user.click(screen.getByRole('button', { name: /^subscribe/i }))

        expect(await screen.findByText(/confirm your payment/i)).toBeInTheDocument()
    })

    it('shows a failure and does not open anything when the checkout cannot start', async () => {
        vi.mocked(api.startCheckout).mockRejectedValue(new Error('provider down'))
        const user = userEvent.setup()
        renderBilling(snapshot({ status: 'trial_expired', ...LAPSED, currentPeriodEnd: null }))
        await screen.findByRole('radio', { name: /^pro/i })

        await user.click(screen.getByRole('button', { name: /^subscribe/i }))

        await waitFor(() => expect(toast.error).toHaveBeenCalled())
        expect(openExternalUrl).not.toHaveBeenCalled()
    })
})

describe('changing plan on a live subscription', () => {
    it('asks for the interval change in-app instead of starting a second checkout', async () => {
        const user = userEvent.setup()
        renderBilling(snapshot({ planCode: 'pro' }))
        await screen.findByRole('radio', { name: /^pro/i })

        await user.click(screen.getByRole('radio', { name: /annual/i }))
        await user.click(screen.getByRole('button', { name: /change plan/i }))

        await waitFor(() => expect(api.requestPlanChange).toHaveBeenCalledWith({ planCode: 'pro', interval: 'annual' }))
        expect(api.startCheckout).not.toHaveBeenCalled()
        expect(toast.success).toHaveBeenCalled()
    })

    it('re-reads the user afterwards so the new entitlement shows up without a reload', async () => {
        const user = userEvent.setup()
        const { updateUser } = renderBilling(snapshot({ planCode: 'pro' }))
        await screen.findByRole('radio', { name: /^pro/i })

        await user.click(screen.getByRole('button', { name: /change plan/i }))

        await waitFor(() => expect(api.fetchCurrentUser).toHaveBeenCalled())
        await waitFor(() => expect(updateUser).toHaveBeenCalled())
    })

    it('reports a refused change without pretending it happened', async () => {
        vi.mocked(api.requestPlanChange).mockRejectedValue(new Error('refused'))
        const user = userEvent.setup()
        renderBilling(snapshot({ planCode: 'pro' }))
        await screen.findByRole('radio', { name: /^pro/i })

        await user.click(screen.getByRole('button', { name: /change plan/i }))

        await waitFor(() => expect(toast.error).toHaveBeenCalled())
        expect(toast.success).not.toHaveBeenCalled()
    })
})

describe('hosted portal', () => {
    it('opens the provider portal for card details and full invoice history', async () => {
        const user = userEvent.setup()
        renderBilling()

        await user.click(await screen.findByRole('button', { name: /manage payment details/i }))

        await waitFor(() => expect(api.openBillingPortal).toHaveBeenCalled())
        expect(openExternalUrl).toHaveBeenCalledWith('https://pay.example/portal')
    })

    it('is not offered to an account that has never paid', async () => {
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ hasBillingCustomer: false, hasLiveSubscription: false }))
        renderBilling(snapshot({ status: 'trialing', trialEndsAt: daysFromNow(9), currentPeriodEnd: null }))
        await screen.findByRole('radio', { name: /^pro/i })

        expect(screen.queryByRole('button', { name: /manage payment details/i })).not.toBeInTheDocument()
    })

    it('stays available to a lapsed customer, who may need to fix a card', async () => {
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ hasBillingCustomer: true, hasLiveSubscription: false }))
        renderBilling(snapshot({ status: 'cancelled', ...LAPSED }))

        expect(await screen.findByRole('button', { name: /manage payment details/i })).toBeInTheDocument()
    })
})

describe('invoice history', () => {
    it('lists each charge with its date, amount, status and a link to the hosted invoice', async () => {
        vi.mocked(api.fetchInvoices).mockResolvedValue([invoice('a'), invoice('b', { status: 'refunded', total: 600 })] as never)
        renderBilling()

        const section = await screen.findByRole('region', { name: /invoice history/i })
        const rows = await within(section).findAllByRole('row')
        expect(rows.length).toBeGreaterThanOrEqual(3)
        expect(section).toHaveTextContent('$12')
        expect(section).toHaveTextContent('$6')
        expect(section).toHaveTextContent(/refunded/i)
        const links = within(section).getAllByRole('link', { name: /view/i })
        expect(links[0]).toHaveAttribute('href', 'https://pay.example/invoice/a')
    })

    it('shows an empty state when there is nothing to list yet', async () => {
        renderBilling()

        expect(await screen.findByText(/no invoices yet/i)).toBeInTheDocument()
    })

    it('still shows the rest of the page if invoices fail to load', async () => {
        vi.mocked(api.fetchInvoices).mockRejectedValue(new Error('provider down'))
        renderBilling()

        expect(await screen.findByText(/could not load your invoices/i)).toBeInTheDocument()
        expect(screen.getByRole('region', { name: /current plan/i })).toBeInTheDocument()
    })
})

describe('cancelling', () => {
    const openCancelFlow = async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(await screen.findByRole('button', { name: /cancel subscription/i }))
        return screen.getByRole('region', { name: /cancel your subscription/i })
    }

    it('shows what happens before asking for confirmation: access until the end date, data kept, export free', async () => {
        const user = userEvent.setup()
        renderBilling(snapshot({ currentPeriodEnd: daysFromNow(20) }))

        const flow = await openCancelFlow(user)

        expect(flow).toHaveTextContent(/full access until/i)
        expect(flow).toHaveTextContent(/nothing is deleted/i)
        expect(flow).toHaveTextContent(/read-only/i)
        expect(flow).toHaveTextContent(/export/i)
        expect(api.requestCancellation).not.toHaveBeenCalled()
    })

    it('states an erase window only when the server is actually enforcing one', async () => {
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ retentionDays: 120 }))
        const user = userEvent.setup()
        renderBilling()

        expect(await openCancelFlow(user)).toHaveTextContent(/120 days/i)
    })

    it('says nothing about erasure when there is no retention window', async () => {
        const user = userEvent.setup()
        renderBilling()

        expect(await openCancelFlow(user)).not.toHaveTextContent(/erase/i)
    })

    it('keeping the subscription closes the panel and cancels nothing', async () => {
        const user = userEvent.setup()
        renderBilling()
        const flow = await openCancelFlow(user)

        await user.click(within(flow).getByRole('button', { name: /keep my subscription/i }))

        expect(screen.queryByRole('region', { name: /cancel your subscription/i })).not.toBeInTheDocument()
        expect(api.requestCancellation).not.toHaveBeenCalled()
    })

    it('does not offer a downgrade to a cheaper plan - there is only one plan', async () => {
        const user = userEvent.setup()
        renderBilling(snapshot({ planCode: 'pro' }))
        const flow = await openCancelFlow(user)

        expect(within(flow).queryByRole('button', { name: /switch to.*instead/i })).not.toBeInTheDocument()
    })

    it('confirming asks the server to cancel, then refreshes the user', async () => {
        const user = userEvent.setup()
        const { updateUser } = renderBilling()
        const flow = await openCancelFlow(user)

        await user.click(within(flow).getByRole('button', { name: /confirm cancellation/i }))

        await waitFor(() => expect(api.requestCancellation).toHaveBeenCalledTimes(1))
        expect(toast.success).toHaveBeenCalled()
        await waitFor(() => expect(updateUser).toHaveBeenCalled())
    })

    it('keeps the panel open and reports the failure when the cancellation is refused', async () => {
        vi.mocked(api.requestCancellation).mockRejectedValue(new Error('refused'))
        const user = userEvent.setup()
        renderBilling()
        const flow = await openCancelFlow(user)

        await user.click(within(flow).getByRole('button', { name: /confirm cancellation/i }))

        await waitFor(() => expect(toast.error).toHaveBeenCalled())
        expect(screen.getByRole('region', { name: /cancel your subscription/i })).toBeInTheDocument()
    })
})

describe('a subscription that is set to end', () => {
    const ending = () => snapshot({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: daysFromNow(12) })

    it('says when it ends and offers to resume instead of to cancel again', async () => {
        renderBilling(ending())

        expect(await screen.findByText(/ends on/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /resume subscription/i })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /cancel subscription/i })).not.toBeInTheDocument()
    })

    it('resuming asks the server and refreshes the user', async () => {
        const user = userEvent.setup()
        const { updateUser } = renderBilling(ending())

        await user.click(await screen.findByRole('button', { name: /resume subscription/i }))

        await waitFor(() => expect(api.requestResume).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(updateUser).toHaveBeenCalled())
    })
})

describe('sync devices', () => {
    const twoDevices = () => ({
        devices: [device({ deviceId: 'desk', kind: 'desktop', current: true }), device({ deviceId: 'phone', kind: 'pwa', canPush: false })],
        limit: 1,
    })

    it('lists the devices, this one first marked, next to the plan limit', async () => {
        vi.mocked(api.fetchDevices).mockResolvedValue(twoDevices())
        renderBilling(snapshot({ planCode: 'plus' }))

        const region = await screen.findByRole('region', { name: /sync devices/i })

        expect(within(region).getAllByRole('listitem')).toHaveLength(2)
        expect(within(region).getByText(/this device/i)).toBeInTheDocument()
        expect(within(region).getByText(/download only/i)).toBeInTheDocument()
    })

    it('removing a device revokes exactly that one and then re-reads the list', async () => {
        vi.mocked(api.fetchDevices).mockResolvedValueOnce(twoDevices()).mockResolvedValue({ devices: [twoDevices().devices[0]], limit: 1 })
        const user = userEvent.setup()
        renderBilling(snapshot({ planCode: 'plus' }))

        await user.click(await screen.findByRole('button', { name: /remove installed web app/i }))
        await user.click(screen.getByRole('button', { name: /yes, remove/i }))

        await waitFor(() => expect(api.revokeDevice).toHaveBeenCalledExactlyOnceWith('phone'))
        await waitFor(() => expect(api.fetchDevices).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(screen.queryByRole('button', { name: /remove installed web app/i })).not.toBeInTheDocument())
        expect(toast.success).toHaveBeenCalled()
    })

    it('renaming a device sends the name and re-reads the list', async () => {
        vi.mocked(api.fetchDevices).mockResolvedValue(twoDevices())
        const user = userEvent.setup()
        renderBilling(snapshot({ planCode: 'plus' }))

        await user.click(await screen.findByRole('button', { name: /rename installed web app/i }))
        await user.type(screen.getByRole('textbox', { name: /device name/i }), 'Phone')
        await user.click(screen.getByRole('button', { name: /^save$/i }))

        await waitFor(() => expect(api.renameDevice).toHaveBeenCalledExactlyOnceWith('phone', 'Phone'))
        await waitFor(() => expect(api.fetchDevices).toHaveBeenCalledTimes(2))
    })

    it('reports a failed removal and leaves the list as it was', async () => {
        vi.mocked(api.fetchDevices).mockResolvedValue(twoDevices())
        vi.mocked(api.revokeDevice).mockRejectedValue(new Error('nope'))
        const user = userEvent.setup()
        renderBilling(snapshot({ planCode: 'plus' }))

        await user.click(await screen.findByRole('button', { name: /remove installed web app/i }))
        await user.click(screen.getByRole('button', { name: /yes, remove/i }))

        await waitFor(() => expect(toast.error).toHaveBeenCalled())
        expect(toast.success).not.toHaveBeenCalled()
        expect(api.fetchDevices).toHaveBeenCalledTimes(1)
    })

    it('is still there, and still works, when the subscription has lapsed: freeing a slot is never locked', async () => {
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ hasBillingCustomer: false, hasLiveSubscription: false }))
        vi.mocked(api.fetchDevices).mockResolvedValue(twoDevices())
        const user = userEvent.setup()
        renderBilling(snapshot({ status: 'cancelled', ...LAPSED, currentPeriodEnd: null }))

        await user.click(await screen.findByRole('button', { name: /remove installed web app/i }))
        await user.click(screen.getByRole('button', { name: /yes, remove/i }))

        await waitFor(() => expect(api.revokeDevice).toHaveBeenCalledWith('phone'))
    })

    it('a failed device load shows in the section and leaves the rest of the page usable', async () => {
        vi.mocked(api.fetchDevices).mockRejectedValue(new Error('offline'))
        renderBilling()

        expect(await screen.findByText(/could not load your devices/i)).toBeInTheDocument()
        expect(screen.getByRole('region', { name: /current plan/i })).toBeInTheDocument()
    })

    it('asks for nothing while billing is off', async () => {
        vi.mocked(api.fetchPublicPlans).mockResolvedValue(plans({ billingEnabled: false, plans: [] }))
        vi.mocked(api.fetchBillingOverview).mockResolvedValue(overview({ billingEnabled: false, hasBillingCustomer: false, hasLiveSubscription: false }))
        renderBilling(snapshot({ billingEnabled: false }))

        await screen.findByText(/billing is not enabled/i)

        expect(api.fetchDevices).not.toHaveBeenCalled()
        expect(screen.queryByRole('region', { name: /sync devices/i })).not.toBeInTheDocument()
    })
})
