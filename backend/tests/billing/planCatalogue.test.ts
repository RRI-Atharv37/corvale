import { describe, it, expect } from 'vitest'

import { DEFAULT_PLAN_CATALOGUE, Plan, seedPlanCatalogue } from '@modules/billing'

/**
 * M1 - the launch catalogue must match ROADMAP § *Pricing architecture* exactly. Money is in
 * minor units (USD cents); `null` means unlimited. Changing a row here is a pricing decision.
 */

const GB = 1024 ** 3

const byCode = (code: string) => {
    const plan = DEFAULT_PLAN_CATALOGUE.find((p) => p.code === code)
    if (!plan) throw new Error(`plan ${code} missing from DEFAULT_PLAN_CATALOGUE`)
    return plan
}

describe('DEFAULT_PLAN_CATALOGUE', () => {
    it('contains exactly Plus and Pro - there is no free tier (decision #4)', () => {
        expect(DEFAULT_PLAN_CATALOGUE.map((p) => p.code).sort()).toEqual(['plus', 'pro'])
    })

    it('Plus: $6/mo, $60/yr, 1 GB receipts, 1 sync device, no workspaces, no priority support', () => {
        const plus = byCode('plus')

        expect(plus.prices).toEqual({ monthly: 600, annual: 6000 })
        expect(plus.limits).toEqual({ receiptStorageBytes: 1 * GB, syncDevices: 1, workspaceMembers: null })
        expect(plus.features).toEqual({ workspaces: false, prioritySupport: false, bankSync: false })
    })

    it('Pro: $12/mo, $96/yr launch price, 10 GB receipts, unlimited devices, workspaces + priority support + bank sync', () => {
        const pro = byCode('pro')

        expect(pro.prices).toEqual({ monthly: 1200, annual: 9600 })
        expect(pro.limits).toEqual({ receiptStorageBytes: 10 * GB, syncDevices: null, workspaceMembers: null })
        expect(pro.features).toEqual({ workspaces: true, prioritySupport: true, bankSync: true })
    })

    it('seedPlanCatalogue writes both plans and is idempotent', async () => {
        await seedPlanCatalogue()
        await seedPlanCatalogue()

        const plans = await Plan.find({}).lean()
        expect(plans.map((p) => p.code).sort()).toEqual(['plus', 'pro'])
    })

    it('seedPlanCatalogue restores a drifted row to the catalogue values', async () => {
        await seedPlanCatalogue()
        await Plan.updateOne({ code: 'plus' }, { $set: { 'limits.syncDevices': 99 } })

        await seedPlanCatalogue()

        const plus = await Plan.findOne({ code: 'plus' }).lean()
        expect(plus?.limits.syncDevices).toBe(1)
    })
})
