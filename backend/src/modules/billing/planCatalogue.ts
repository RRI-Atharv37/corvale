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

/** Launch catalogue, ROADMAP § Pricing architecture. Prices are USD minor units; null = unlimited. */
export const DEFAULT_PLAN_CATALOGUE: readonly PlanCatalogueEntry[] = [
    {
        code: 'plus',
        name: 'Plus',
        prices: { monthly: 600, annual: 6000 },
        features: { workspaces: false, prioritySupport: false, bankSync: false },
        limits: { receiptStorageBytes: 1 * GB, syncDevices: 1, workspaceMembers: null },
    },
    {
        code: 'pro',
        name: 'Pro',
        prices: { monthly: 1200, annual: 9600 },
        features: { workspaces: true, prioritySupport: true, bankSync: true },
        limits: { receiptStorageBytes: 10 * GB, syncDevices: null, workspaceMembers: null },
    },
]

export const seedPlanCatalogue = async (): Promise<void> => {
    await Plan.bulkWrite(
        DEFAULT_PLAN_CATALOGUE.map(({ code, ...fields }) => ({
            updateOne: { filter: { code }, update: { $set: fields }, upsert: true },
        }))
    )
}
