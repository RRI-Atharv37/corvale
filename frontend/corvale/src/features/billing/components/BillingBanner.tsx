import React from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useEntitlements } from '@/app/providers/useEntitlements'
import { describeBilling } from '../billingFormat'
import { NoticeIcon } from './BillingNoticeCard'
import { noticeRole, noticeToneClass } from './noticeStyle'

const BILLING_PATH = '/settings/billing'
// A trial that has weeks left is not worth a permanent strip across every page.
const TRIAL_BANNER_DAYS = 7

/**
 * The always-visible reminder about the billing state. It changes nothing about what the user can
 * reach: it states the state, says the data is kept, and links to the one page that can fix it.
 */
const BillingBanner: React.FC = () => {
    const { entitlements } = useEntitlements()
    const { pathname } = useLocation()

    if (pathname.startsWith(BILLING_PATH)) return null

    const notice = describeBilling(entitlements, new Date())
    if (!notice) return null
    if (notice.kind === 'trialing' && (notice.daysLeft ?? 0) > TRIAL_BANNER_DAYS) return null

    return (
        <div
            role={noticeRole(notice)}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm lg:px-8 ${noticeToneClass(notice)}`}
        >
            <NoticeIcon tone={notice.tone} />
            <p className="min-w-0 flex-1 text-text-secondary">
                <span className="font-semibold text-text-primary">{notice.title}.</span> {notice.message}
            </p>
            <Link to={BILLING_PATH} className="btn-ghost shrink-0 py-1.5 px-3">
                {notice.cta}
            </Link>
        </div>
    )
}

export default BillingBanner
