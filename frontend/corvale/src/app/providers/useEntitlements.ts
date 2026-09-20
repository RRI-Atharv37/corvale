import { useEffect, useMemo, useState } from 'react'

import { msUntilWriteLapses, resolveClientEntitlements } from '@lib/entitlements'
import type { BillingFeature, EntitlementSnapshot } from '@lib/types/api'
import { useUser } from './useUser'

// setTimeout treats anything past a signed 32-bit int as "fire now".
const MAX_TIMER_MS = 2 ** 31 - 1

export interface UseEntitlements {
    entitlements: Readonly<EntitlementSnapshot>
    status: EntitlementSnapshot['status']
    planCode: EntitlementSnapshot['planCode']
    canRead: boolean
    canWrite: boolean
    canExport: boolean
    isReadOnly: boolean
    has: (feature: BillingFeature) => boolean
}

/**
 * The signed-in user's entitlements, read off the user payload (no extra request). UX only - the
 * server enforces every gate. A missing or stale snapshot resolves to read-only, never to locked,
 * and write access lapsing while the app is open is picked up without a reload.
 */
export const useEntitlements = (): UseEntitlements => {
    const { user } = useUser()
    const snapshot = user?.entitlements
    const [tick, setTick] = useState(0)

    const entitlements = useMemo(
        () => resolveClientEntitlements(snapshot, new Date()),
        // `tick` re-resolves when write access lapses; the clock is read inside on purpose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [snapshot, tick]
    )

    useEffect(() => {
        const wait = msUntilWriteLapses(snapshot, new Date())
        if (wait === null) return
        const timer = setTimeout(() => setTick((n) => n + 1), Math.min(wait, MAX_TIMER_MS))
        return () => clearTimeout(timer)
    }, [snapshot, tick])

    return useMemo(
        () => ({
            entitlements,
            status: entitlements.status,
            planCode: entitlements.planCode,
            canRead: entitlements.canRead,
            canWrite: entitlements.canWrite,
            canExport: entitlements.canExport,
            isReadOnly: !entitlements.canWrite,
            has: (feature: BillingFeature) => entitlements.features[feature],
        }),
        [entitlements]
    )
}
