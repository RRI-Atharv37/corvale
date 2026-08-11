import React, { useCallback } from 'react'
import { AxiosError } from 'axios'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ApiResponse, SaverDetails } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import dayjs from 'dayjs'

const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount)

interface SaverResponse {
    message: string
    data: SaverDetails
}

const Saver = () => {
    const fetchSaver = useCallback(async (): Promise<SaverDetails | null> => {
        try {
            const response = await axiosInstance.get<ApiResponse<SaverResponse>>(API_PATHS.SAVER.DETAILS)
            const payload = unwrapApiData(response)
            return payload.data
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 404) {
                return null
            }
            throw new Error(getApiErrorMessage(error, 'Failed to load saver balance'))
        }
    }, [])

    const { data, loading, error, refetch } = useAsyncData(fetchSaver, [fetchSaver])

    return (
        <div>
            <PageHeader
                title="Saver"
                description="Your monthly savings balance — actions coming in Sprint 0.6"
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={(saver) => saver === null || saver.saverAmount === 0}
                loadingMessage="Loading saver balance..."
                emptyTitle="No saver balance yet"
                emptyDescription="Add to your saver once you start tracking income and expenses."
                onRetry={refetch}
            >
                {(saver) => (
                    <div className="card max-w-md border-cyan-500/20 bg-cyan-500/5">
                        <p className="text-xs text-slate-400 uppercase tracking-wide">Current balance</p>
                        <p className="text-3xl font-semibold text-cyan-300 mt-2">
                            {formatCurrency(saver.saverAmount)}
                        </p>
                        {saver.saverDate && (
                            <p className="text-xs text-slate-500 mt-2">
                                Last updated {dayjs(saver.saverDate).format('MMM D, YYYY')}
                            </p>
                        )}
                    </div>
                )}
            </AsyncContent>
        </div>
    )
}

export default Saver
