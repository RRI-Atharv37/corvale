import React from 'react'

import { useEntitlements } from '@/app/providers/useEntitlements'
import type { BillingFeature } from '@lib/types/api'

interface GatedProps {
    /** The plan must include this feature. A read-only user keeps a feature their plan has. */
    feature?: BillingFeature
    /** The user must be able to write - hides controls that change data while read-only. */
    write?: boolean
    fallback?: React.ReactNode
    children: React.ReactNode
}

/**
 * Hides or replaces UI the plan doesn't include. UX only: every gate also exists server-side, so
 * this is never a security boundary. With neither prop it renders its children unconditionally.
 */
const Gated: React.FC<GatedProps> = ({ feature, write, fallback = null, children }) => {
    const { has, canWrite } = useEntitlements()

    const allowed = (!feature || has(feature)) && (!write || canWrite)

    return <>{allowed ? children : fallback}</>
}

export default Gated
