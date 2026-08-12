import React, { useCallback, useState } from 'react'
import dayjs from 'dayjs'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import FormField from '../../components/forms/FormField'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ApiResponse, SaverDetails, SaverResponse } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency } from '../../utils/format'

const Saver = () => {
    const [addMode, setAddMode] = useState<'percentage' | 'custom'>('percentage')
    const [percentage, setPercentage] = useState('30')
    const [customAmount, setCustomAmount] = useState('')
    const [withdrawAmount, setWithdrawAmount] = useState('')
    const [adding, setAdding] = useState(false)
    const [withdrawing, setWithdrawing] = useState(false)

    const fetchSaverData = useCallback(async (): Promise<SaverDetails> => {
        try {
            const response = await axiosInstance.get<ApiResponse<SaverResponse>>(API_PATHS.SAVER.DETAILS)
            const payload = unwrapApiData(response)
            return payload.data
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load saver data'))
        }
    }, [])

    const { data, loading, error, refetch } = useAsyncData(fetchSaverData, [fetchSaverData])

    const computedPreview =
        addMode === 'percentage' && data
            ? (data.spendableBalance * Number(percentage || 0)) / 100
            : Number(customAmount || 0)

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!data) return

        const body: Record<string, number> = {}

        if (addMode === 'percentage') {
            body.percentage = Number(percentage)
        } else {
            body.customAmount = Number(customAmount)
        }

        if (addMode === 'custom' && (!customAmount || Number(customAmount) <= 0)) {
            toast.error('Enter a valid amount')
            return
        }

        setAdding(true)
        try {
            await axiosInstance.post(API_PATHS.SAVER.ADD, body)
            toast.success('Added to saver')
            setCustomAmount('')
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to add to saver'))
        } finally {
            setAdding(false)
        }
    }

    const handleWithdraw = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!withdrawAmount || Number(withdrawAmount) <= 0) {
            toast.error('Enter a valid withdrawal amount')
            return
        }

        setWithdrawing(true)
        try {
            await axiosInstance.post(API_PATHS.SAVER.WITHDRAW, { amount: Number(withdrawAmount) })
            toast.success('Withdrawn from saver')
            setWithdrawAmount('')
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to withdraw from saver'))
        } finally {
            setWithdrawing(false)
        }
    }

    return (
        <div>
            <PageHeader
                title="Saver"
                description="Move funds from spendable balance into your saver pool"
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={() => false}
                loadingMessage="Loading saver..."
                emptyTitle="No data"
                emptyDescription=""
                onRetry={refetch}
            >
                {(balances) => (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl">
                            <div className="card border-cyan-500/20 bg-cyan-500/5">
                                <p className="text-xs text-slate-400 uppercase tracking-wide">Saver balance</p>
                                <p className="text-3xl font-semibold text-cyan-300 mt-2">
                                    {formatCurrency(balances.saverBalance)}
                                </p>
                                {balances.saverDate && (
                                    <p className="text-xs text-slate-500 mt-2">
                                        Last updated {dayjs(balances.saverDate).format('MMM D, YYYY')}
                                    </p>
                                )}
                            </div>
                            <div className="card">
                                <p className="text-xs text-slate-400 uppercase tracking-wide">Spendable balance</p>
                                <p className="text-3xl font-semibold text-slate-200 mt-2">
                                    {formatCurrency(balances.spendableBalance)}
                                </p>
                                <p className="text-xs text-slate-500 mt-2">
                                    {balances.balanceSource === 'accounts'
                                        ? 'Checking & cash accounts minus saver'
                                        : 'Income − expenses − saver allocations'}
                                </p>
                            </div>
                            <div className="card border-violet-500/20 bg-violet-500/5">
                                <p className="text-xs text-slate-400 uppercase tracking-wide">Net worth</p>
                                <p className="text-3xl font-semibold text-violet-300 mt-2">
                                    {formatCurrency(balances.netWorth)}
                                </p>
                                <p className="text-xs text-slate-500 mt-2">
                                    {balances.balanceSource === 'accounts'
                                        ? `Across ${balances.accountCount} account${balances.accountCount === 1 ? '' : 's'}`
                                        : 'Spendable + saver'}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
                            <div className="card">
                                <h3 className="text-sm font-medium text-slate-200 mb-4">Add to saver</h3>
                                <form onSubmit={handleAdd} className="space-y-4">
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setAddMode('percentage')}
                                            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                                                addMode === 'percentage'
                                                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                                                    : 'border-slate-700 text-slate-400 hover:border-slate-600'
                                            }`}
                                        >
                                            Percentage
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAddMode('custom')}
                                            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                                                addMode === 'custom'
                                                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                                                    : 'border-slate-700 text-slate-400 hover:border-slate-600'
                                            }`}
                                        >
                                            Custom amount
                                        </button>
                                    </div>

                                    {addMode === 'percentage' ? (
                                        <FormField
                                            label="Percentage of spendable balance"
                                            type="number"
                                            value={percentage}
                                            onChange={setPercentage}
                                            placeholder="30"
                                            disabled={adding}
                                            min="0"
                                            max="100"
                                            step="1"
                                        />
                                    ) : (
                                        <FormField
                                            label="Amount"
                                            type="number"
                                            value={customAmount}
                                            onChange={setCustomAmount}
                                            placeholder="0.00"
                                            disabled={adding}
                                            min="0"
                                            step="0.01"
                                        />
                                    )}

                                    <p className="text-xs text-slate-500">
                                        Will add: {formatCurrency(computedPreview)}
                                    </p>

                                    <button
                                        type="submit"
                                        disabled={adding || balances.spendableBalance <= 0}
                                        className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
                                    >
                                        {adding ? 'Adding...' : 'Add to saver'}
                                    </button>
                                </form>
                            </div>

                            <div className="card">
                                <h3 className="text-sm font-medium text-slate-200 mb-4">Withdraw from saver</h3>
                                <form onSubmit={handleWithdraw} className="space-y-4">
                                    <FormField
                                        label="Amount"
                                        type="number"
                                        value={withdrawAmount}
                                        onChange={setWithdrawAmount}
                                        placeholder="0.00"
                                        disabled={withdrawing}
                                        min="0"
                                        step="0.01"
                                    />
                                    <p className="text-xs text-slate-500">
                                        Returns funds to your spendable balance
                                    </p>
                                    <button
                                        type="submit"
                                        disabled={withdrawing || balances.saverBalance <= 0}
                                        className="w-full px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/30 hover:text-cyan-300 transition-colors disabled:opacity-50"
                                    >
                                        {withdrawing ? 'Withdrawing...' : 'Withdraw'}
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                )}
            </AsyncContent>
        </div>
    )
}

export default Saver
