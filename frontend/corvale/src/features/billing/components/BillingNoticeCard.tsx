import React from 'react'
import { FiAlertCircle, FiClock, FiInfo } from 'react-icons/fi'

import type { BillingNotice } from '../types'
import { noticeRole, noticeToneClass } from './noticeStyle'

export const NoticeIcon: React.FC<{ tone: BillingNotice['tone'] }> = ({ tone }) =>
    tone === 'danger' ? (
        <FiAlertCircle size={18} className="shrink-0 text-destructive" aria-hidden="true" />
    ) : tone === 'warning' ? (
        <FiClock size={18} className="shrink-0 text-warning" aria-hidden="true" />
    ) : (
        <FiInfo size={18} className="shrink-0 text-accent" aria-hidden="true" />
    )

const BillingNoticeCard: React.FC<{ notice: BillingNotice }> = ({ notice }) => (
    <div role={noticeRole(notice)} className={`flex items-start gap-3 rounded-xl border p-4 ${noticeToneClass(notice)}`}>
        <NoticeIcon tone={notice.tone} />
        <div>
            <p className="text-sm font-semibold text-text-primary">{notice.title}</p>
            <p className="mt-1 text-sm text-text-secondary">{notice.message}</p>
        </div>
    </div>
)

export default BillingNoticeCard
