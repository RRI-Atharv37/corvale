import { useCallback, useState } from 'react'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { syncNow } from '@platform/sync/syncEngine'
import type { ApiResponse, Transaction } from '@lib/types/api'

export interface UseRecurringDraftsResult {
    drafts: Transaction[]
    draftsLoading: boolean
    draftsError: string | null
    generatingDrafts: boolean
    generatingRuleId: string | null
    draftActionId: string | null
    fetchDrafts: () => Promise<void>
    generateAndRefreshDrafts: () => Promise<void>
    generateDraftsForRule: (ruleId: string) => Promise<void>
    confirmDraft: (draft: Transaction) => Promise<void>
    dismissDraft: (draft: Transaction) => Promise<void>
}

/**
 * Draft generation/confirm/dismiss stay server-authoritative unconditionally (the
 * "Server-authoritative" architecture decision: "Notifications, recurring draft generation,
 * auto-contribution execution stay pull-only - the client never creates them, so they cannot
 * conflict"). Every REST call here runs
 * regardless of `VITE_LOCAL_FIRST`; when the flag is on, a successful call is followed by `syncNow()`
 * so the local `transactions` mirror picks up the resulting draft/posted-transaction changes via pull
 * (confirming/dismissing a draft mutates a `Transaction` row, which IS a syncable local table).
 * Callers must gate these actions on `useOnlineStatus()` themselves (see `Recurring.tsx`) since they
 * have no offline-queueable local fallback.
 */
export const useRecurringDrafts = (onRulesChanged?: () => Promise<void>): UseRecurringDraftsResult => {
    const [drafts, setDrafts] = useState<Transaction[]>([])
    const [draftsLoading, setDraftsLoading] = useState(false)
    const [draftsError, setDraftsError] = useState<string | null>(null)
    const [generatingDrafts, setGeneratingDrafts] = useState(false)
    const [generatingRuleId, setGeneratingRuleId] = useState<string | null>(null)
    const [draftActionId, setDraftActionId] = useState<string | null>(null)

    const fetchDrafts = useCallback(async () => {
        setDraftsLoading(true)
        setDraftsError(null)
        try {
            const response = await axiosInstance.get<ApiResponse<Transaction[]>>(API_PATHS.RECURRING_RULES.GET_DRAFTS)
            setDrafts(unwrapApiData(response))
        } catch (err) {
            setDraftsError(getApiErrorMessage(err, 'Failed to load drafts'))
        } finally {
            setDraftsLoading(false)
        }
    }, [])

    const generateAndRefreshDrafts = useCallback(async () => {
        setGeneratingDrafts(true)
        try {
            await axiosInstance.post(API_PATHS.RECURRING_RULES.GENERATE_DRAFTS)
            if (isLocalFirstEnabled()) {
                await syncNow()
            }
            await fetchDrafts()
            await onRulesChanged?.()
        } finally {
            setGeneratingDrafts(false)
        }
    }, [fetchDrafts, onRulesChanged])

    const generateDraftsForRule = useCallback(
        async (ruleId: string) => {
            setGeneratingRuleId(ruleId)
            try {
                await axiosInstance.post(API_PATHS.RECURRING_RULES.GENERATE_DRAFTS_FOR_RULE(ruleId))
                if (isLocalFirstEnabled()) {
                    await syncNow()
                }
                await fetchDrafts()
                await onRulesChanged?.()
            } finally {
                setGeneratingRuleId(null)
            }
        },
        [fetchDrafts, onRulesChanged]
    )

    const confirmDraft = useCallback(
        async (draft: Transaction) => {
            setDraftActionId(draft._id)
            try {
                await axiosInstance.post(API_PATHS.RECURRING_RULES.CONFIRM_DRAFT(draft._id))
                if (isLocalFirstEnabled()) {
                    await syncNow()
                }
                await fetchDrafts()
            } finally {
                setDraftActionId(null)
            }
        },
        [fetchDrafts]
    )

    const dismissDraft = useCallback(
        async (draft: Transaction) => {
            setDraftActionId(draft._id)
            try {
                await axiosInstance.post(API_PATHS.RECURRING_RULES.DISMISS_DRAFT(draft._id))
                if (isLocalFirstEnabled()) {
                    await syncNow()
                }
                await fetchDrafts()
            } finally {
                setDraftActionId(null)
            }
        },
        [fetchDrafts]
    )

    return {
        drafts,
        draftsLoading,
        draftsError,
        generatingDrafts,
        generatingRuleId,
        draftActionId,
        fetchDrafts,
        generateAndRefreshDrafts,
        generateDraftsForRule,
        confirmDraft,
        dismissDraft,
    }
}
