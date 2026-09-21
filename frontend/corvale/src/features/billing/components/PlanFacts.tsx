import React from 'react'
import { FiCheck, FiMinus } from 'react-icons/fi'

import { formatBytes, whole } from '../billingFormat'
import type { PublicPlan } from '../types'

const Row: React.FC<{ included?: boolean; children: React.ReactNode }> = ({ included = true, children }) => (
    <li className={`flex items-start gap-2 text-sm ${included ? 'text-text-secondary' : 'text-text-quiet'}`}>
        {included ? (
            <FiCheck size={16} className="mt-0.5 shrink-0 text-positive" aria-hidden="true" />
        ) : (
            <FiMinus size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        )}
        <span>{children}</span>
    </li>
)

const PlanFacts: React.FC<{ plan: PublicPlan }> = ({ plan }) => (
    <ul className="space-y-2">
        <Row>Unlimited accounts and transactions</Row>
        <Row>{formatBytes(plan.limits.receiptStorageBytes)} receipt storage</Row>
        <Row>
            {plan.limits.syncDevices === null
                ? 'Unlimited devices with offline sync'
                : `${whole(plan.limits.syncDevices, 'device')} with offline sync`}
        </Row>
        <Row included={plan.features.workspaces}>
            {plan.features.workspaces ? 'Workspaces with owner, editor and viewer roles' : 'Workspaces (not included)'}
        </Row>
        <Row included={plan.features.prioritySupport}>
            {plan.features.prioritySupport ? 'Priority support' : 'Priority support (not included)'}
        </Row>
    </ul>
)

export default PlanFacts
