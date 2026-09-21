import { scrubAuditIps } from './adminAudit.service'

export interface AdminSweepResult {
    auditIpsScrubbed: number
}

/** Housekeeping for the admin collections; called by the scheduled billing sweep script. */
export const runAdminSweeps = async (now: Date = new Date()): Promise<AdminSweepResult> => ({
    auditIpsScrubbed: await scrubAuditIps(now),
})
