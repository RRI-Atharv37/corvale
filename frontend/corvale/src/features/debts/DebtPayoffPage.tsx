import React, { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import PageHeader from '@ui/PageHeader'
import AsyncContent from '@ui/AsyncContent'
import StatCard from '@ui/StatCard'
import Disclaimer from '@ui/Disclaimer'
import { DISCLAIMERS } from '@lib/disclaimers'
import FormField from '@ui/forms/FormField'
import AccountMultiSelect from '@features/budgets/components/AccountMultiSelect'
import { useWorkspace } from '@/app/providers/useWorkspace'
import WorkspaceReadOnlyBanner from '@features/workspaces/components/WorkspaceReadOnlyBanner'
import { useDebtPayoffData } from './hooks/useDebtPayoffData'
import type { DebtPayoffPlan, DebtPayoffStrategy } from '@features/debts/types'
import { getApiErrorMessage } from '@lib/apiError'
import { formatCurrency } from '@lib/format'
import {
    axisTick,
    CHART_CATEGORY_COLORS,
    CHART_COLORS,
    chartMargin,
    chartTooltipProps,
    formatChartCurrency,
    yAxisTick,
} from '@features/dashboard/components/chartTheme'

const STRATEGY_OPTIONS: { value: DebtPayoffStrategy; label: string; description: string }[] = [
    {
        value: 'snowball',
        label: 'Snowball',
        description: 'Pay off the smallest balance first for quick wins',
    },
    {
        value: 'avalanche',
        label: 'Avalanche',
        description: 'Pay off the highest interest rate first to minimize total interest',
    },
]

const DebtPayoff: React.FC = () => {
    const { activeWorkspace, isPersonal, canEdit } = useWorkspace()
    const [strategy, setStrategy] = useState<DebtPayoffStrategy>('snowball')
    const [extraPayment, setExtraPayment] = useState('0')
    const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [plan, setPlan] = useState<DebtPayoffPlan | null>(null)

    const {
        accounts,
        loading: accountsLoading,
        error: accountsError,
        refetch: refetchAccounts,
        generatePlan,
    } = useDebtPayoffData()

    const creditAccounts = useMemo(
        () => (accounts ?? []).filter((account) => account.type === 'credit' && account.currentBalance < 0),
        [accounts]
    )

    const accountNameById = useMemo(() => {
        const map = new Map<string, string>()
        for (const account of accounts ?? []) {
            map.set(account._id, account.name)
        }
        return map
    }, [accounts])

    const handlePlan = async (e: React.FormEvent) => {
        e.preventDefault()

        const extra = Number(extraPayment)
        if (isNaN(extra) || extra < 0) {
            toast.error('Extra payment must be a non-negative number')
            return
        }

        setSubmitting(true)
        try {
            const generatedPlan = await generatePlan(strategy, extra, selectedAccountIds)
            setPlan(generatedPlan)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to generate payoff plan'))
        } finally {
            setSubmitting(false)
        }
    }

    const chartData = useMemo(() => {
        if (!plan) return []
        return plan.months.map((month) => {
            const row: Record<string, number> = { month: month.month }
            for (const payment of month.payments) {
                row[payment.accountId] = payment.remainingBalance
            }
            return row
        })
    }, [plan])

    const payoffDates = useMemo(() => {
        if (!plan) return []
        return plan.order.map((accountId) => {
            const monthPaidOff = plan.months.find((month) =>
                month.payments.some((p) => p.accountId === accountId && p.remainingBalance === 0)
            )
            return {
                accountId,
                name: accountNameById.get(accountId) ?? accountId,
                monthPaidOff: monthPaidOff?.month ?? null,
            }
        })
    }, [plan, accountNameById])

    return (
        <div>
            <PageHeader
                title="Debt payoff planner"
                description={
                    isPersonal
                        ? 'Snowball or avalanche plan to pay off your credit accounts'
                        : `Debt planner for ${activeWorkspace?.name ?? 'workspace'}`
                }
                note={<Disclaimer tone="caution">{DISCLAIMERS.debtPayoff}</Disclaimer>}
            />

            <WorkspaceReadOnlyBanner />

            <AsyncContent
                loading={accountsLoading}
                error={accountsError}
                data={accounts}
                isEmpty={() => creditAccounts.length === 0}
                loadingMessage="Loading credit accounts..."
                emptyTitle="No credit card debt found"
                emptyDescription="Add a credit account with a negative balance, interest rate, and minimum payment to start planning."
                onRetry={refetchAccounts}
            >
                {() => (
                    <div className="space-y-6">
                        <form onSubmit={handlePlan} className="card space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {STRATEGY_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setStrategy(option.value)}
                                        className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                                            strategy === option.value
                                                ? 'bg-accent-subtle text-accent border-accent/30'
                                                : 'border-border-subtle text-fg-secondary hover:border-border'
                                        }`}
                                    >
                                        <p className="text-sm font-medium">{option.label}</p>
                                        <p className="text-xs mt-0.5 opacity-80">{option.description}</p>
                                    </button>
                                ))}
                            </div>

                            <FormField
                                label="Extra monthly payment"
                                type="number"
                                value={extraPayment}
                                onChange={setExtraPayment}
                                placeholder="0.00"
                                step="0.01"
                                min="0"
                                disabled={submitting || !canEdit}
                            />

                            <div>
                                <p className="text-[13px] text-fg-secondary mb-2">Credit accounts to include</p>
                                <AccountMultiSelect
                                    accounts={creditAccounts}
                                    selectedIds={selectedAccountIds}
                                    onChange={setSelectedAccountIds}
                                    disabled={submitting || !canEdit}
                                    emptyMessage="No credit accounts with a balance available."
                                    allSelectedMessage="All credit accounts with a balance are included in the plan."
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submitting || !canEdit}
                                className="w-full px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
                            >
                                {submitting ? 'Calculating...' : 'Generate payoff plan'}
                            </button>
                        </form>

                        {plan && (
                            <div className="card space-y-4">
                                {plan.order.length === 0 ? (
                                    <p className="text-sm text-fg-muted">
                                        No debt to plan for the selected accounts.
                                    </p>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                            <StatCard
                                                label="Payoff time"
                                                value={`${plan.totalMonths} mo`}
                                                accent="neutral"
                                            />
                                            <StatCard
                                                label="Total interest paid"
                                                value={formatCurrency(plan.totalInterestPaid)}
                                                accent="expense"
                                            />
                                            <StatCard
                                                label="Extra payment"
                                                value={formatCurrency(plan.extraPayment)}
                                                accent="accent"
                                            />
                                        </div>

                                        <div>
                                            <p className="text-[13px] text-fg-secondary mb-2">Payoff order</p>
                                            <ol className="space-y-1.5">
                                                {payoffDates.map((entry, index) => (
                                                    <li
                                                        key={entry.accountId}
                                                        className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2"
                                                    >
                                                        <span className="text-sm text-fg">
                                                            {index + 1}. {entry.name}
                                                        </span>
                                                        <span className="text-xs text-fg-muted">
                                                            {entry.monthPaidOff
                                                                ? `Paid off in month ${entry.monthPaidOff}`
                                                                : 'In progress'}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ol>
                                        </div>

                                        {chartData.length > 0 && (
                                            <div className="h-64">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={chartData} margin={chartMargin}>
                                                        <CartesianGrid
                                                            stroke={CHART_COLORS.grid}
                                                            strokeDasharray="3 3"
                                                            vertical={false}
                                                        />
                                                        <XAxis
                                                            dataKey="month"
                                                            tick={axisTick}
                                                            axisLine={false}
                                                            tickLine={false}
                                                        />
                                                        <YAxis
                                                            tick={yAxisTick}
                                                            axisLine={false}
                                                            tickLine={false}
                                                            tickFormatter={formatChartCurrency}
                                                            width={52}
                                                        />
                                                        <Tooltip
                                                            {...chartTooltipProps}
                                                            formatter={(value: number) => formatCurrency(value)}
                                                        />
                                                        <Legend
                                                            wrapperStyle={{ fontSize: '0.75rem', color: CHART_COLORS.axis }}
                                                            formatter={(accountId: string) =>
                                                                accountNameById.get(accountId) ?? accountId
                                                            }
                                                        />
                                                        {plan.order.map((accountId, index) => (
                                                            <Line
                                                                key={accountId}
                                                                type="monotone"
                                                                dataKey={accountId}
                                                                stroke={
                                                                    CHART_CATEGORY_COLORS[
                                                                        index % CHART_CATEGORY_COLORS.length
                                                                    ]
                                                                }
                                                                strokeWidth={2}
                                                                dot={false}
                                                            />
                                                        ))}
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </AsyncContent>
        </div>
    )
}

export default DebtPayoff
