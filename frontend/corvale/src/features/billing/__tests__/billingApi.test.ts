import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import {
    fetchBillingOverview,
    fetchInvoices,
    fetchPublicPlans,
    openBillingPortal,
    requestCancellation,
    requestPlanChange,
    requestResume,
    startCheckout,
} from '../billingApi'
import { overview, plans } from './fixtures'

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

beforeEach(() => {
    vi.mocked(axiosInstance.get).mockReset()
    vi.mocked(axiosInstance.post).mockReset()
})

afterEach(() => vi.clearAllMocks())

describe('billing API paths', () => {
    it('lives under /billing, next to the routes the server mounts', () => {
        expect(API_PATHS.BILLING).toEqual({
            PLANS: '/billing/plans',
            OVERVIEW: '/billing/overview',
            INVOICES: '/billing/invoices',
            CHECKOUT: '/billing/checkout',
            PORTAL: '/billing/portal',
            CHANGE_PLAN: '/billing/change-plan',
            CANCEL: '/billing/cancel',
            RESUME: '/billing/resume',
        })
    })
})

describe('reads', () => {
    it('fetchPublicPlans unwraps the plan list', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: plans() })

        expect(await fetchPublicPlans()).toEqual(plans())
        expect(axiosInstance.get).toHaveBeenCalledWith(API_PATHS.BILLING.PLANS)
    })

    it('fetchBillingOverview unwraps the overview', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: overview() })

        expect(await fetchBillingOverview()).toEqual(overview())
        expect(axiosInstance.get).toHaveBeenCalledWith(API_PATHS.BILLING.OVERVIEW)
    })

    it('fetchInvoices returns the invoice array', async () => {
        const invoice = { id: 'a', issuedAt: '2026-01-20T00:00:00.000Z', total: 1200, currency: 'USD', status: 'paid', url: null }
        vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: { invoices: [invoice] } })

        expect(await fetchInvoices()).toEqual([invoice])
        expect(axiosInstance.get).toHaveBeenCalledWith(API_PATHS.BILLING.INVOICES)
    })
})

describe('actions', () => {
    it('startCheckout sends only the plan and interval, and returns the hosted URL', async () => {
        vi.mocked(axiosInstance.post).mockResolvedValue({ success: true, data: { url: 'https://pay.example/checkout' } })

        expect(await startCheckout({ planCode: 'pro', interval: 'annual' })).toBe('https://pay.example/checkout')
        expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.BILLING.CHECKOUT, { planCode: 'pro', interval: 'annual' })
    })

    it('openBillingPortal returns the hosted portal URL', async () => {
        vi.mocked(axiosInstance.post).mockResolvedValue({ success: true, data: { url: 'https://pay.example/portal' } })

        expect(await openBillingPortal()).toBe('https://pay.example/portal')
        expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.BILLING.PORTAL, {})
    })

    it('requestPlanChange, requestCancellation and requestResume post to their own routes', async () => {
        vi.mocked(axiosInstance.post).mockResolvedValue({ success: true, data: { requested: true } })

        await requestPlanChange({ planCode: 'plus', interval: 'monthly' })
        await requestCancellation()
        await requestResume()

        expect(axiosInstance.post).toHaveBeenNthCalledWith(1, API_PATHS.BILLING.CHANGE_PLAN, { planCode: 'plus', interval: 'monthly' })
        expect(axiosInstance.post).toHaveBeenNthCalledWith(2, API_PATHS.BILLING.CANCEL, {})
        expect(axiosInstance.post).toHaveBeenNthCalledWith(3, API_PATHS.BILLING.RESUME, {})
    })

    it('refuses a hosted URL that is not https, rather than hand it to the browser', async () => {
        vi.mocked(axiosInstance.post).mockResolvedValue({ success: true, data: { url: 'javascript:alert(1)' } })

        await expect(startCheckout({ planCode: 'plus', interval: 'monthly' })).rejects.toThrow(/could not open/i)
        await expect(openBillingPortal()).rejects.toThrow(/could not open/i)
    })
})
