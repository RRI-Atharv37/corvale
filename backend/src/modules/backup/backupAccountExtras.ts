import { Types } from 'mongoose'

import { ReconciliationSession } from '@modules/reconciliation'
import { SavedReport } from '@modules/reports'
import { Pushover, Saver } from '@modules/savers'
import { SyncDevice } from '@modules/billing'
import { User } from '@modules/users'
import { Workspace } from '@modules/workspaces'
import { buildScopedListFilter } from '@core/access/workspace'

import type { BackupAccountExtras } from './backupFormat'
import { serializeDoc } from './backupSerialize'

const toRecord = (doc: unknown): Record<string, unknown> => serializeDoc(doc as Record<string, unknown>)

const exportProfile = async (userId: string): Promise<Record<string, unknown> | null> => {
    const user = await User.findById(userId).lean()
    if (!user) return null
    return {
        fullName: user.fullName,
        email: user.email,
        timezone: user.timezone,
        preferredCurrency: user.preferredCurrency,
        dateFormat: user.dateFormat,
        pageSize: user.pageSize,
        notificationPreferences: user.notificationPreferences,
        emailPreferences: user.emailPreferences,
        exchangeRates: user.exchangeRates,
        isEmailVerified: user.isEmailVerified,
        legalAcceptance: user.legalAcceptance
            ? { ...user.legalAcceptance, acceptedAt: new Date(user.legalAcceptance.acceptedAt).toISOString() }
            : null,
        createdAt: new Date((user as { createdAt?: Date }).createdAt ?? 0).toISOString(),
    }
}

const exportMemberships = async (userId: string): Promise<Record<string, unknown>[]> => {
    const workspaces = await Workspace.find({ 'members.userId': new Types.ObjectId(userId) }).lean()
    return workspaces.map((workspace) => ({
        id: workspace._id.toString(),
        name: workspace.name,
        role: workspace.members.find((member) => member.userId.toString() === userId)?.role ?? null,
    }))
}

/**
 * SEC-93: the parts of "everything" the main export sections do not cover. Sessions and saved reports
 * follow the export scope. The rest belongs to the person rather than to a workspace, so a workspace
 * export leaves it out. Credentials, token state and the user id are never included.
 */
export const exportAccountExtras = async (
    userId: string,
    workspaceId: string | null
): Promise<BackupAccountExtras> => {
    const scopeFilter = buildScopedListFilter(userId, workspaceId)

    const [reconciliationSessions, savedReports] = await Promise.all([
        ReconciliationSession.find(scopeFilter).lean(),
        SavedReport.find(scopeFilter).lean(),
    ])

    if (workspaceId) {
        return {
            reconciliationSessions: reconciliationSessions.map(toRecord),
            savedReports: savedReports.map(toRecord),
            savers: [],
            rollovers: [],
            profile: null,
            devices: [],
            workspaceMemberships: [],
        }
    }

    const [savers, rollovers, devices, profile, workspaceMemberships] = await Promise.all([
        Saver.find({ userId }).lean(),
        Pushover.find({ userId }).lean(),
        SyncDevice.find({ userId }).lean(),
        exportProfile(userId),
        exportMemberships(userId),
    ])

    return {
        reconciliationSessions: reconciliationSessions.map(toRecord),
        savedReports: savedReports.map(toRecord),
        savers: savers.map(toRecord),
        rollovers: rollovers.map(toRecord),
        profile,
        devices: devices.map(toRecord),
        workspaceMemberships,
    }
}
