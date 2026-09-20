import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { UserContext } from '../UserContext'
import { useEntitlements } from '../useEntitlements'
import type { EntitlementSnapshot, User } from '@lib/types/api'

/**
 * M2d - `useEntitlements()` reads the snapshot off the user in context. No extra request; no
 * snapshot means read-only, never locked. Re-evaluates on its own when write access lapses while
 * the app is open.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-20T12:00:00.000Z')
const iso = (ms: number): string => new Date(NOW.getTime() + ms).toISOString()

const snapshot = (overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot => ({
    billingEnabled: true,
    status: 'active',
    planCode: 'pro',
    canRead: true,
    canWrite: true,
    canExport: true,
    canSyncPull: true,
    canSyncPush: true,
    features: { workspaces: true, prioritySupport: false, bankSync: false },
    limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: 3 },
    trialEndsAt: null,
    currentPeriodEnd: iso(30 * DAY),
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    resolvedAt: NOW.toISOString(),
    writableUntil: null,
    ...overrides,
})

const userWith = (entitlements?: EntitlementSnapshot): User => ({
    _id: 'u1',
    fullName: 'Jamie',
    email: 'jamie@example.com',
    ...(entitlements ? { entitlements } : {}),
})

const Probe = () => {
    const e = useEntitlements()
    return (
        <div>
            <span data-testid="write">{String(e.canWrite)}</span>
            <span data-testid="read">{String(e.canRead)}</span>
            <span data-testid="export">{String(e.canExport)}</span>
            <span data-testid="readonly">{String(e.isReadOnly)}</span>
            <span data-testid="status">{e.status}</span>
            <span data-testid="workspaces">{String(e.has('workspaces'))}</span>
            <span data-testid="bank">{String(e.has('bankSync'))}</span>
        </div>
    )
}

const renderFor = (user: User | null) =>
    render(
        <UserContext.Provider
            value={{ user, isAuthenticated: !!user } as unknown as React.ContextType<typeof UserContext>}
        >
            <Probe />
        </UserContext.Provider>
    )

const text = (id: string): string | null => screen.getByTestId(id).textContent

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
})

afterEach(() => {
    vi.useRealTimers()
})

describe('useEntitlements', () => {
    it('reads the snapshot from the user in context', () => {
        renderFor(userWith(snapshot()))

        expect(text('write')).toBe('true')
        expect(text('readonly')).toBe('false')
        expect(text('status')).toBe('active')
    })

    it('has(feature) reflects the plan', () => {
        renderFor(userWith(snapshot()))

        expect(text('workspaces')).toBe('true')
        expect(text('bank')).toBe('false')
    })

    it('a user with no snapshot is read-only, never locked out', () => {
        renderFor(userWith())

        expect(text('write')).toBe('false')
        expect(text('readonly')).toBe('true')
        expect(text('read')).toBe('true')
        expect(text('export')).toBe('true')
        expect(text('workspaces')).toBe('false')
    })

    it('no user at all is read-only too (the hook does not throw before sign-in resolves)', () => {
        renderFor(null)

        expect(text('write')).toBe('false')
        expect(text('read')).toBe('true')
    })

    it('a lapsed subscription is read-only', () => {
        renderFor(userWith(snapshot({ status: 'trial_expired', canWrite: false, canSyncPush: false })))

        expect(text('readonly')).toBe('true')
        expect(text('status')).toBe('trial_expired')
    })

    it('billing off is never read-only', () => {
        renderFor(userWith(snapshot({ billingEnabled: false, planCode: null })))

        expect(text('readonly')).toBe('false')
        expect(text('bank')).toBe('true')
    })

    it('drops to read-only by itself when writableUntil passes while the app is open', () => {
        renderFor(userWith(snapshot({ status: 'trialing', writableUntil: iso(60_000) })))
        expect(text('write')).toBe('true')

        act(() => {
            vi.advanceTimersByTime(60_001)
        })

        expect(text('write')).toBe('false')
        expect(text('status')).toBe('trial_expired')
        expect(text('read')).toBe('true')
    })

    it('an already-passed writableUntil (an old offline cache) is read-only on first render', () => {
        renderFor(userWith(snapshot({ status: 'trialing', writableUntil: iso(-DAY) })))

        expect(text('write')).toBe('false')
    })

    it('handles a writableUntil further out than a timer can hold without firing early', () => {
        renderFor(userWith(snapshot({ status: 'trialing', writableUntil: iso(90 * DAY) })))

        act(() => {
            vi.advanceTimersByTime(30 * DAY)
        })

        expect(text('write')).toBe('true')
    })

    it('picks up a fresh snapshot when the user changes', () => {
        const { rerender } = renderFor(userWith(snapshot({ status: 'cancelled', canWrite: false, canSyncPush: false })))
        expect(text('write')).toBe('false')

        rerender(
            <UserContext.Provider
                value={{ user: userWith(snapshot()), isAuthenticated: true } as unknown as React.ContextType<typeof UserContext>}
            >
                <Probe />
            </UserContext.Provider>
        )

        expect(text('write')).toBe('true')
    })
})
