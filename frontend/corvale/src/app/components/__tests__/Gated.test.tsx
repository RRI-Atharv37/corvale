import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { UserContext } from '@/app/providers/UserContext'
import Gated from '../Gated'
import type { EntitlementSnapshot, User } from '@lib/types/api'

/**
 * M2d - `<Gated>` is UX only: it hides or replaces controls the plan does not include. Every gate
 * also exists server-side (M1 proves that by calling the API directly), so nothing here is a
 * security boundary.
 */

const NOW = new Date().toISOString()

const snapshot = (overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot => ({
    billingEnabled: true,
    status: 'active',
    planCode: 'plus',
    canRead: true,
    canWrite: true,
    canExport: true,
    canSyncPull: true,
    canSyncPush: true,
    features: { workspaces: false, prioritySupport: false, bankSync: false },
    limits: { receiptStorageBytes: 1000, syncDevices: 1, workspaceMembers: null },
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    resolvedAt: NOW,
    writableUntil: null,
    ...overrides,
})

const renderGated = (entitlements: EntitlementSnapshot | undefined, ui: React.ReactElement) => {
    const user: User = { _id: 'u1', fullName: 'Jamie', email: 'j@example.com', ...(entitlements ? { entitlements } : {}) }
    return render(
        <UserContext.Provider value={{ user, isAuthenticated: true } as unknown as React.ContextType<typeof UserContext>}>
            {ui}
        </UserContext.Provider>
    )
}

const READ_ONLY = { status: 'trial_expired', canWrite: false, canSyncPush: false } as const

describe('<Gated feature>', () => {
    it('renders children when the plan includes the feature', () => {
        renderGated(snapshot({ features: { workspaces: true, prioritySupport: false, bankSync: false } }), (
            <Gated feature="workspaces">
                <button>New workspace</button>
            </Gated>
        ))

        expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument()
    })

    it('renders the fallback when it does not', () => {
        renderGated(snapshot(), (
            <Gated feature="workspaces" fallback={<p>Upgrade to Pro</p>}>
                <button>New workspace</button>
            </Gated>
        ))

        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument()
    })

    it('renders nothing by default when the feature is missing', () => {
        const { container } = renderGated(snapshot(), (
            <Gated feature="bankSync">
                <button>Connect</button>
            </Gated>
        ))

        expect(container).toBeEmptyDOMElement()
    })

    it('a read-only user still sees a feature their plan includes (so they can read it)', () => {
        renderGated(snapshot({ ...READ_ONLY, features: { workspaces: true, prioritySupport: false, bankSync: false } }), (
            <Gated feature="workspaces">
                <p>Shared budgets</p>
            </Gated>
        ))

        expect(screen.getByText('Shared budgets')).toBeInTheDocument()
    })

    it('billing off shows every feature', () => {
        renderGated(snapshot({ billingEnabled: false, planCode: null, features: { workspaces: true, prioritySupport: true, bankSync: true } }), (
            <Gated feature="bankSync">
                <p>Bank sync</p>
            </Gated>
        ))

        expect(screen.getByText('Bank sync')).toBeInTheDocument()
    })
})

describe('<Gated write>', () => {
    it('renders children while the user can write', () => {
        renderGated(snapshot(), (
            <Gated write>
                <button>Add transaction</button>
            </Gated>
        ))

        expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument()
    })

    it('hides write controls when read-only, and shows the fallback', () => {
        renderGated(snapshot(READ_ONLY), (
            <Gated write fallback={<p>Read-only</p>}>
                <button>Add transaction</button>
            </Gated>
        ))

        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        expect(screen.getByText('Read-only')).toBeInTheDocument()
    })

    it('a user with no snapshot is treated as read-only', () => {
        renderGated(undefined, (
            <Gated write fallback={<p>Read-only</p>}>
                <button>Add transaction</button>
            </Gated>
        ))

        expect(screen.getByText('Read-only')).toBeInTheDocument()
    })
})

describe('<Gated feature write>', () => {
    it('needs both: the feature and write access', () => {
        const withFeature = { workspaces: true, prioritySupport: false, bankSync: false }
        const ui = (
            <Gated feature="workspaces" write fallback={<p>Blocked</p>}>
                <button>Invite member</button>
            </Gated>
        )

        const ok = renderGated(snapshot({ features: withFeature }), ui)
        expect(screen.getByRole('button', { name: 'Invite member' })).toBeInTheDocument()
        ok.unmount()

        const lapsed = renderGated(snapshot({ ...READ_ONLY, features: withFeature }), ui)
        expect(screen.getByText('Blocked')).toBeInTheDocument()
        lapsed.unmount()

        renderGated(snapshot(), ui)
        expect(screen.getByText('Blocked')).toBeInTheDocument()
    })
})

describe('<Gated> with no condition', () => {
    it('always renders its children (nothing to gate on)', () => {
        renderGated(snapshot(READ_ONLY), (
            <Gated>
                <p>Always here</p>
            </Gated>
        ))

        expect(screen.getByText('Always here')).toBeInTheDocument()
    })
})
