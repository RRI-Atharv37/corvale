import React, { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Disclaimer from '../../components/ui/Disclaimer'
import { DISCLAIMERS } from '../../utils/disclaimers'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type {
    ApiResponse,
    PushoverRolloverResponse,
    PushoverSnapshot,
    SaverDetails,
    SaverResponse,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency, formatDisplayDateTime } from '../../utils/format'

interface PushoverPageData {
    history: PushoverSnapshot[]
    saverBalance: number
}

const Pushover = () => {
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [rolling, setRolling] = useState(false)

    const fetchPageData = useCallback(async (): Promise<PushoverPageData> => {
        try {
            const [historyRes, saverRes] = await Promise.all([
                axiosInstance.get<ApiResponse<PushoverSnapshot[]>>(API_PATHS.PUSHOVER.HISTORY),
                axiosInstance.get<ApiResponse<SaverResponse>>(API_PATHS.SAVER.DETAILS),
            ])

            const history = unwrapApiData(historyRes)
            const saverPayload = unwrapApiData(saverRes)
            const balances = saverPayload.data as SaverDetails

            return {
                history,
                saverBalance: balances.saverBalance,
            }
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load pushover data'))
        }
    }, [])

    const { data, loading, error, refetch } = useAsyncData(fetchPageData, [fetchPageData])

    const handleRollover = async () => {
        setRolling(true)
        try {
            const response = await axiosInstance.post<ApiResponse<PushoverRolloverResponse>>(
                API_PATHS.PUSHOVER.PUSHOVER
            )
            const payload = unwrapApiData(response)
            toast.success(
                `Rolled over ${formatCurrency(payload.data.pushoverAmount)} to next month`
            )
            setConfirmOpen(false)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to roll over savings'))
        } finally {
            setRolling(false)
        }
    }

    return (
        <div>
            <PageHeader
                title="Pushover"
                description="Roll your verified saver balance into a month-end snapshot"
                note={<Disclaimer>{DISCLAIMERS.pushover}</Disclaimer>}
                actions={
                    <button
                        type="button"
                        onClick={() => setConfirmOpen(true)}
                        disabled={!data || data.saverBalance <= 0}
                        className="btn-accent px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Roll over now
                    </button>
                }
            />

            {data && data.saverBalance <= 0 && (
                <p className="text-xs text-fg-muted mb-4 -mt-4">
                    Add funds to your saver before rolling over. Rollover uses your verified saver balance only.
                </p>
            )}

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={(pageData) => pageData.history.length === 0}
                loadingMessage="Loading pushover history..."
                emptyTitle="No pushover history yet"
                emptyDescription="When you roll over savings at month-end, snapshots will appear here."
                onRetry={refetch}
            >
                {(pageData) => (
                    <div className="space-y-3">
                        {pageData.history.map((item) => (
                            <div key={item._id} className="card flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium text-fg">
                                        {new Date(item.pushoverDate).toLocaleDateString('en-US', {
                                            month: 'long',
                                            year: 'numeric',
                                        })}{' '}
                                        rollover
                                    </p>
                                    <p className="text-xs text-fg-muted mt-0.5">
                                        {formatDisplayDateTime(item.pushoverDate)}
                                    </p>
                                </div>
                                <p className="text-sm font-semibold text-violet-400">
                                    {formatCurrency(item.pushoverAmount)}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </AsyncContent>

            <ConfirmDialog
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={handleRollover}
                title="Roll over savings"
                message={
                    data
                        ? `This will snapshot your verified saver balance of ${formatCurrency(data.saverBalance)} and reset it to zero. Continue?`
                        : 'This will snapshot your verified saver balance and reset it to zero. Continue?'
                }
                confirmLabel="Roll over"
                loading={rolling}
            />
        </div>
    )
}

export default Pushover
