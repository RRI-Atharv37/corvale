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
    it('contains exactly one plan, Pro - there is no free tier (decision #4) and no Plus tier (2026-09-22: $6/mo does not cover hosting/overhead)', () => {
        expect(DEFAULT_PLAN_CATALOGUE.map((p) => p.code).sort()).toEqual(['pro'])
    })

    it('Pro: $12/mo, $96/yr launch price, 10 GB receipts, unlimited devices, workspaces + priority support + bank sync', () => {
        const pro = byCode('pro')

        expect(pro.prices).toEqual({ monthly: 1200, annual: 9600 })
        expect(pro.limits).toEqual({ receiptStorageBytes: 10 * GB, syncDevices: null, workspaceMembers: null })
        expect(pro.features).toEqual({ workspaces: true, prioritySupport: true, bankSync: true })
    })

    it('seedPlanCatalogue writes the plan and is idempotent', async () => {
        await seedPlanCatalogue()
        await seedPlanCatalogue()

        const plans = await Plan.find({}).lean()
        expect(plans.map((p) => p.code).sort()).toEqual(['pro'])
    })

    it('seedPlanCatalogue restores a drifted row to the catalogue values', async () => {
        await seedPlanCatalogue()
        await Plan.updateOne({ code: 'pro' }, { $set: { 'limits.syncDevices': 99 } })

        await seedPlanCatalogue()

        const pro = await Plan.findOne({ code: 'pro' }).lean()
        expect(pro?.limits.syncDevices).toBe(null)
    })

    it('seedPlanCatalogue removes a plan row whose code is no longer in the catalogue', async () => {
        await Plan.create({
            code: 'plus',
            name: 'Plus',
            prices: { monthly: 600, annual: 6000 },
            limits: { receiptStorageBytes: 1 * GB, syncDevices: 1, workspaceMembers: null },
            features: { workspaces: false, prioritySupport: false, bankSync: false },
        })

        await seedPlanCatalogue()

        const plans = await Plan.find({}).lean()
        expect(plans.map((p) => p.code).sort()).toEqual(['pro'])
    })
})
