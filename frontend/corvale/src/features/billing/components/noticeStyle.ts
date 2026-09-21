import type { BillingNotice } from '../types'

const TONES: Record<BillingNotice['tone'], string> = {
    info: 'border-accent/30 bg-accent-subtle',
    warning: 'border-warning/40 bg-warning/10',
    danger: 'border-destructive/40 bg-destructive/10',
}

export const noticeRole = (notice: BillingNotice): 'alert' | 'status' => (notice.tone === 'danger' ? 'alert' : 'status')

export const noticeToneClass = (notice: BillingNotice): string => TONES[notice.tone]
