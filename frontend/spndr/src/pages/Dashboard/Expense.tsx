import React, { useCallback } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ApiResponse, Expense, PaginatedExpense } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import dayjs from 'dayjs'

const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount)

const Expense = () => {
    const fetchExpenses = useCallback(async (): Promise<Expense[]> => {
        try {
            const response = await axiosInstance.get<ApiResponse<PaginatedExpense>>(
                API_PATHS.EXPENSE.GET_ALL,
                { params: { page: 1, limit: 50 } }
            )
            const payload = unwrapApiData(response)
            return payload.data
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load expenses'))
        }
    }, [])

    const { data, loading, error, refetch } = useAsyncData(fetchExpenses, [fetchExpenses])

    return (
        <div>
            <PageHeader
                title="Expenses"
                description="Your expense entries — CRUD forms coming in Sprint 0.6"
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={(items) => items.length === 0}
                loadingMessage="Loading expenses..."
                emptyTitle="No expenses yet"
                emptyDescription="Expense entries will appear here once you add them."
                onRetry={refetch}
            >
                {(items) => (
                    <div className="space-y-3">
                        {items.map((item) => (
                            <div key={item._id} className="card flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium text-slate-200">{item.title}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {dayjs(item.date).format('MMM D, YYYY')} · {item.category}
                                    </p>
                                </div>
                                <p className="text-sm font-semibold text-rose-400">
                                    {formatCurrency(item.amount)}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </AsyncContent>
        </div>
    )
}

export default Expense
