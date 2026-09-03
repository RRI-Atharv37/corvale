import React, { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { IoCheckmarkCircle, IoCheckmarkCircleOutline, IoTimeOutline } from 'react-icons/io5'
import Modal from '@ui/Modal'
import AsyncContent from '@ui/AsyncContent'
import FormField from '@ui/forms/FormField'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { formatCurrency, toDateInputValue } from '@lib/format'
import type { Account, ReconciliationSession } from '@features/accounts/types'
import type { Transaction } from '@features/transactions/types'

interface ReconciliationModalProps {
    account: Account
    open: boolean
    onClose: () => void
    onReconciled?: () => void
}

const ReconciliationModal: React.FC<ReconciliationModalProps> = ({
    account,
    open,
    onClose,
    onReconciled,
}) => {
    const [statementEndDate, setStatementEndDate] = useState(() => toDateInputValue(new Date()))
    const [statementBalance, setStatementBalance] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [togglingId, setTogglingId] = useState<string | null>(null)
    const [finishing, setFinishing] = useState(false)
    const [result, setResult] = useState<ReconciliationSession | null>(null)

    const fetchTransactions = useCallback(async (): Promise<Transaction[]> => {
        try {
            const response = await axiosInstance.get(API_PATHS.TRANSACTIONS.GET_ALL, {
                params: { accountId: account._id, limit: 200, sortBy: 'date', sortOrder: 'asc' },
            })
            const data = unwrapApiData(response) as { data: Transaction[] }
            return data.data.filter((t) => t.clearedStatus !== 'reconciled')
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load transactions'))
        }
    }, [account._id])

    const {
        data: transactions,
        loading,
        error,
        refetch,
    } = useAsyncData(fetchTransactions, [fetchTransactions])

    const fetchHistory = useCallback(async (): Promise<ReconciliationSession[]> => {
        try {
            const response = await axiosInstance.get(
                API_PATHS.ACCOUNTS.RECONCILIATION_SESSIONS(account._id)
            )
            return unwrapApiData(response) as ReconciliationSession[]
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load reconciliation history'))
        }
    }, [account._id])

    const { data: history, refetch: refetchHistory } = useAsyncData(fetchHistory, [fetchHistory])

    const clearedTotal = useMemo(() => {
        if (!transactions) return 0
        return transactions
            .filter((t) => t.clearedStatus === 'cleared')
            .reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0)
    }, [transactions])

    const toggleCleared = async (transaction: Transaction) => {
        const nextStatus = transaction.clearedStatus === 'cleared' ? 'pending' : 'cleared'
        setTogglingId(transaction._id)
        try {
            await axiosInstance.patch(API_PATHS.TRANSACTIONS.UPDATE_CLEARED_STATUS(transaction._id), {
                clearedStatus: nextStatus,
            })
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update transaction'))
        } finally {
            setTogglingId(null)
        }
    }

    const handleReconcile = async (e: React.FormEvent) => {
        e.preventDefault()

        const parsedBalance = Number(statementBalance)
        if (statementBalance.trim() === '' || isNaN(parsedBalance)) {
            toast.error('Statement balance must be a valid number')
            return
        }

        setSubmitting(true)
        try {
            const response = await axiosInstance.post(API_PATHS.RECONCILIATION.CREATE_SESSION, {
                accountId: account._id,
                statementEndDate: new Date(statementEndDate).toISOString(),
                statementBalance: parsedBalance,
            })
            const session = unwrapApiData(response) as ReconciliationSession
            setResult(session)
            await refetchHistory()
            toast.success('Reconciliation session created')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create reconciliation session'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleFinish = async () => {
        if (!transactions || !result) return

        const statementEnd = new Date(result.statementEndDate)
        const toReconcile = transactions.filter(
            (t) => t.clearedStatus === 'cleared' && new Date(t.date) <= statementEnd
        )

        if (toReconcile.length === 0) {
            toast.error('No cleared transactions to reconcile')
            return
        }

        setFinishing(true)
        try {
            await Promise.all(
                toReconcile.map((t) =>
                    axiosInstance.patch(API_PATHS.TRANSACTIONS.UPDATE_CLEARED_STATUS(t._id), {
                        clearedStatus: 'reconciled',
                        reconciledAt: new Date().toISOString(),
                    })
                )
            )
            toast.success('Reconciliation complete')
            setResult(null)
            setStatementBalance('')
            await refetch()
            await refetchHistory()
            onReconciled?.()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to finish reconciliation'))
        } finally {
            setFinishing(false)
        }
    }

    const handleClose = () => {
        setResult(null)
        setStatementBalance('')
        onClose()
    }

    return (
        <Modal open={open} onClose={handleClose} title={`Reconcile "${account.name}"`} size="lg">
            <div className="space-y-5">
                <form onSubmit={handleReconcile} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <FormField
                            label="Statement end date"
                            type="date"
                            value={statementEndDate}
                            onChange={setStatementEndDate}
                            required
                            disabled={submitting}
                        />
                        <FormField
                            label="Statement balance"
                            type="number"
                            value={statementBalance}
                            onChange={setStatementBalance}
                            placeholder="0.00"
                            step="0.01"
                            required
                            disabled={submitting}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
                    >
                        {submitting ? 'Comparing...' : 'Compare to statement'}
                    </button>
                </form>

                {result && (
                    <div className="card space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-fg-secondary">Cleared balance</span>
                            <span className="font-medium text-fg">
                                {formatCurrency(result.clearedBalance, account.currency)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-fg-secondary">Pending (uncleared)</span>
                            <span className="font-medium text-fg">
                                {formatCurrency(result.pendingBalance, account.currency)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-fg-secondary">Statement balance</span>
                            <span className="font-medium text-fg">
                                {formatCurrency(result.statementBalance, account.currency)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm pt-2 border-t border-border-subtle">
                            <span className="text-fg-secondary">Differential</span>
                            <span
                                className={`font-semibold ${
                                    result.balanceDifferential === 0 ? 'text-income' : 'text-expense'
                                }`}
                            >
                                {formatCurrency(result.balanceDifferential, account.currency)}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={handleFinish}
                            disabled={finishing}
                            className="w-full mt-2 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                        >
                            {finishing ? 'Finishing...' : 'Mark cleared transactions as reconciled'}
                        </button>
                    </div>
                )}

                <div>
                    <p className="text-[13px] text-fg-secondary mb-2">
                        Mark transactions cleared as they appear on your statement. Live cleared total:{' '}
                        <span className="font-medium text-fg">
                            {formatCurrency(clearedTotal, account.currency)}
                        </span>
                    </p>
                    <AsyncContent
                        loading={loading}
                        error={error}
                        data={transactions}
                        isEmpty={(items) => items.length === 0}
                        loadingMessage="Loading transactions..."
                        emptyTitle="No unreconciled transactions"
                        emptyDescription="This account has no pending or cleared transactions."
                        onRetry={refetch}
                    >
                        {(items) => (
                            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                                {items.map((transaction) => (
                                    <button
                                        key={transaction._id}
                                        type="button"
                                        onClick={() => toggleCleared(transaction)}
                                        disabled={togglingId === transaction._id}
                                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2 text-left hover:border-accent transition-colors disabled:opacity-50"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            {transaction.clearedStatus === 'cleared' ? (
                                                <IoCheckmarkCircle size={18} className="text-income shrink-0" />
                                            ) : (
                                                <IoCheckmarkCircleOutline
                                                    size={18}
                                                    className="text-fg-muted shrink-0"
                                                />
                                            )}
                                            <div className="min-w-0">
                                                <p className="text-sm text-fg truncate">{transaction.title}</p>
                                                <p className="text-[11px] text-fg-muted">
                                                    {new Date(transaction.date).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                        <span
                                            className={`text-sm font-medium shrink-0 ${
                                                transaction.type === 'income' ? 'text-income' : 'text-expense'
                                            }`}
                                        >
                                            {transaction.type === 'income' ? '+' : '-'}
                                            {formatCurrency(transaction.amount, account.currency)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </AsyncContent>
                </div>

                {history && history.length > 0 && (
                    <div>
                        <p className="text-[13px] text-fg-secondary mb-2 flex items-center gap-1.5">
                            <IoTimeOutline size={14} />
                            Past reconciliations
                        </p>
                        <div className="space-y-1.5">
                            {history.map((session) => (
                                <div
                                    key={session._id}
                                    className="flex items-center justify-between text-xs text-fg-muted px-3 py-1.5 rounded-lg bg-surface"
                                >
                                    <span>
                                        {new Date(session.statementEndDate).toLocaleDateString()}
                                    </span>
                                    <span>
                                        {formatCurrency(session.statementBalance, account.currency)}
                                    </span>
                                    <span
                                        className={
                                            session.balanceDifferential === 0 ? 'text-income' : 'text-expense'
                                        }
                                    >
                                        {formatCurrency(session.balanceDifferential, account.currency)} diff
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    )
}

export default ReconciliationModal
