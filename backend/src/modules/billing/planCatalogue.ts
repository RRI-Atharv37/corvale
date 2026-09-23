import type { PlanCode } from '@core/billing/constants'

import Plan from './plan.model'

const GB = 1024 ** 3

export interface PlanCatalogueEntry {
    code: PlanCode
    name: string
    prices: { monthly: number; annual: number }
    features: { workspaces: boolean; prioritySupport: boolean; bankSync: boolean }
    limits: {
        receiptStorageBytes: number | null
        syncDevices: number | null
        workspaceMembers: number | null
    }
}

/**
 * Launch catalogue, ROADMAP § Pricing architecture. Prices are USD minor units; null = unlimited.
 * Single plan only (2026-09-22): the earlier Plus tier ($6/mo) was dropped - it didn't cover
 * hosting/overhead, so there is no cheaper landing spot below Pro.
 */
export const DEFAULT_PLAN_CATALOGUE: readonly PlanCatalogueEntry[] = [
    {
        code: 'pro',
        name: 'Pro',
        prices: { monthly: 1200, annual: 9600 },
        features: { workspaces: true, prioritySupport: true, bankSync: true },
        limits: { receiptStorageBytes: 10 * GB, syncDevices: null, workspaceMembers: null },
    },
]

export const seedPlanCatalogue = async (): Promise<void> => {
    const codes = DEFAULT_PLAN_CATALOGUE.map((entry) => entry.code)

    await Plan.bulkWrite(
        DEFAULT_PLAN_CATALOGUE.map(({ code, ...fields }) => ({
            updateOne: { filter: { code }, update: { $set: fields }, upsert: true },
        }))
    )
    await Plan.deleteMany({ code: { $nin: codes } })
}
