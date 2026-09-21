import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { render } from '@testing-library/react'
import { vi } from 'vitest'

import { UserContext } from '@/app/providers/UserContext'
import type { EntitlementSnapshot, User } from '@lib/types/api'
import type { BillingOverview, PublicPlans, SyncDevice } from '../types'

export const DAY_MS = 24 * 60 * 60 * 1000
export const daysFromNow = (days: number): string => new Date(Date.now() + days * DAY_MS + 12 * 60 * 60 * 1000).toISOString()

export const snapshot = (overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot => ({
    billingEnabled: true,
    status: 'active',
    planCode: 'pro',
    canRead: true,
    canWrite: true,
    canExport: true,
    canSyncPull: true,
    canSyncPush: true,
    features: { workspaces: true, prioritySupport: true, bankSync: true },
    limits: { receiptStorageBytes: 10 * 1024 ** 3, syncDevices: null, workspaceMembers: null },
    trialEndsAt: null,
    currentPeriodEnd: daysFromNow(20),
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    resolvedAt: new Date().toISOString(),
    writableUntil: null,
    ...overrides,
})

export const LAPSED = { canWrite: false, canSyncPush: false } as const

export const plans = (overrides: Partial<PublicPlans> = {}): PublicPlans => ({
    billingEnabled: true,
    trialDays: 30,
    plans: [
        {
            code: 'plus',
            name: 'Plus',
            prices: { monthly: 600, annual: 6000 },
            features: { workspaces: false, prioritySupport: false, bankSync: false },
            limits: { receiptStorageBytes: 1024 ** 3, syncDevices: 1, workspaceMembers: null },
        },
        {
            code: 'pro',
            name: 'Pro',
            prices: { monthly: 1200, annual: 9600 },
            features: { workspaces: true, prioritySupport: true, bankSync: true },
            limits: { receiptStorageBytes: 10 * 1024 ** 3, syncDevices: null, workspaceMembers: null },
        },
    ],
    ...overrides,
})

export const overview = (overrides: Partial<BillingOverview> = {}): BillingOverview => ({
    billingEnabled: true,
    hasBillingCustomer: true,
    hasLiveSubscription: true,
    retentionDays: null,
    ...overrides,
})

export const device = (overrides: Partial<SyncDevice> = {}): SyncDevice => ({
    deviceId: 'device-a',
    kind: 'desktop',
    name: null,
    firstSeenAt: '2026-03-01T09:00:00.000Z',
    lastSeenAt: '2026-04-10T09:00:00.000Z',
    current: false,
    canPush: true,
    ...overrides,
})

export interface RenderOptions {
    entitlements?: EntitlementSnapshot
    signedIn?: boolean
    route?: string
}

/** Puts a user with the given entitlement snapshot into context; `updateUser` is returned so a test can see it fire. */
export const renderWithUser = (ui: React.ReactElement, { entitlements, signedIn = true, route = '/' }: RenderOptions = {}) => {
    const updateUser = vi.fn()
    const user: User | null = signedIn
        ? { _id: 'u1', fullName: 'Jamie Rivera', email: 'jamie@example.com', ...(entitlements ? { entitlements } : {}) }
        : null
    const value = { user, isAuthenticated: signedIn, updateUser } as unknown as React.ContextType<typeof UserContext>

    const view = render(
        <MemoryRouter initialEntries={[route]}>
            <UserContext.Provider value={value}>{ui}</UserContext.Provider>
        </MemoryRouter>
    )
    return { ...view, updateUser }
}
