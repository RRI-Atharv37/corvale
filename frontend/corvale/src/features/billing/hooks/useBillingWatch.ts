import { useCallback, useEffect, useRef } from 'react'

import type { EntitlementSnapshot, User } from '@lib/types/api'
import { fetchCurrentUser } from '../billingApi'

const POLL_MS = 3000
const MAX_ATTEMPTS = 40

const signature = (entitlements: EntitlementSnapshot | undefined): string =>
    entitlements
        ? [entitlements.planCode, entitlements.status, entitlements.cancelAtPeriodEnd, entitlements.currentPeriodEnd, entitlements.canWrite].join('|')
        : ''

interface UseBillingWatchOptions {
    onUser: (user: User) => void
    /** Runs once the entitlement snapshot differs from where the watch started. */
    onChanged: () => void
}

/**
 * Billing changes reach Corvale by webhook, seconds after the hosted page or API call finished.
 * `watch` re-reads the user straight away and then every few seconds until the entitlements differ
 * from `baseline` (or it gives up), so a checkout or plan change shows up without a reload. It only
 * ever reads: nothing the client does here can move an entitlement.
 */
export const useBillingWatch = ({ onUser, onChanged }: UseBillingWatchOptions) => {
    const generation = useRef(0)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const callbacks = useRef({ onUser, onChanged })
    callbacks.current = { onUser, onChanged }

    const stop = useCallback(() => {
        generation.current += 1
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
    }, [])

    useEffect(() => stop, [stop])

    const watch = useCallback(
        async (baseline: EntitlementSnapshot | undefined) => {
            stop()
            const mine = generation.current
            const before = signature(baseline)

            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
                try {
                    const user = await fetchCurrentUser()
                    if (mine !== generation.current) return
                    callbacks.current.onUser(user)
                    if (signature(user.entitlements) !== before) {
                        callbacks.current.onChanged()
                        return
                    }
                } catch {
                    if (mine !== generation.current) return
                }
                await new Promise<void>((resolve) => {
                    timer.current = setTimeout(resolve, POLL_MS)
                })
                if (mine !== generation.current) return
            }
        },
        [stop]
    )

    return { watch, stop }
}
