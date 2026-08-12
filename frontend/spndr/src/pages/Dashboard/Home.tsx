import React, { useCallback } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useUser } from '../../hooks/useUser'
import type { ApiResponse, PaginatedTransactions, SaverResponse } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { Link } from 'react-router-dom'
import { formatCurrency } from '../../utils/format'

interface DashboardSummary {
    incomeCount: number
    expenseCount: number
    incomeTotal: number
    expenseTotal: number
    spendableBalance: number
    saverBalance: number
    netWorth: number
    totalAccountBalance: number
    accountCount: number
    balanceSource: 'accounts' | 'legacy'
}

const Home = () => {
    const { user } = useUser()

    const fetchSummary = useCallback(async (): Promise<DashboardSummary> => {
        try {
            const [incomeRes, expenseRes, saverRes] = await Promise.all([
                axiosInstance.get<ApiResponse<PaginatedTransactions>>(API_PATHS.TRANSACTIONS.GET_ALL, {
                    params: { page: 1, limit: 1, type: 'income' },
                }),
                axiosInstance.get<ApiResponse<PaginatedTransactions>>(API_PATHS.TRANSACTIONS.GET_ALL, {
                    params: { page: 1, limit: 1, type: 'expense' },
                }),
                axiosInstance.get<ApiResponse<SaverResponse>>(API_PATHS.SAVER.DETAILS),
            ])

            const income = unwrapApiData(incomeRes)
            const expense = unwrapApiData(expenseRes)
            const saver = unwrapApiData(saverRes).data

            return {
                incomeCount: income.meta.totalTransactions ?? income.data.length,
                expenseCount: expense.meta.totalTransactions ?? expense.data.length,
                incomeTotal: saver.totalIncome,
                expenseTotal: saver.totalExpenses,
                spendableBalance: saver.spendableBalance,
                saverBalance: saver.saverBalance,
                netWorth: saver.netWorth,
                totalAccountBalance: saver.totalAccountBalance,
                accountCount: saver.accountCount,
                balanceSource: saver.balanceSource,
            }
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load dashboard summary'))
        }
    }, [])

    const { data, loading, error, refetch } = useAsyncData(fetchSummary, [fetchSummary])

    return (
        <div>
            <PageHeader
                title="Dashboard"
                description={`Overview for ${user?.fullName ?? 'your account'}`}
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={() => false}
                loadingMessage="Loading dashboard..."
                emptyTitle="No data yet"
                emptyDescription="Start by adding transactions."
                onRetry={refetch}
            >
                {(summary) => {
                    const spendableSubtitle =
                        summary.balanceSource === 'accounts'
                            ? `From checking & cash · Saver: ${formatCurrency(summary.saverBalance)}`
                            : `Saver: ${formatCurrency(summary.saverBalance)}`

                    const netWorthSubtitle =
                        summary.balanceSource === 'accounts'
                            ? `Across ${summary.accountCount} account${summary.accountCount === 1 ? '' : 's'}`
                            : `${summary.incomeCount + summary.expenseCount} transactions`

                    return (
                        <>
                            <div
                                className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${
                                    summary.balanceSource === 'accounts'
                                        ? 'lg:grid-cols-5'
                                        : 'lg:grid-cols-4'
                                }`}
                            >
                                <StatCard
                                    label="Total Income"
                                    value={formatCurrency(summary.incomeTotal)}
                                    accent="cyan"
                                />
                                <StatCard
                                    label="Total Expenses"
                                    value={formatCurrency(summary.expenseTotal)}
                                    accent="rose"
                                />
                                <StatCard
                                    label="Spendable Balance"
                                    value={formatCurrency(summary.spendableBalance)}
                                    accent="violet"
                                    subtitle={spendableSubtitle}
                                />
                                <StatCard
                                    label="Net Worth"
                                    value={formatCurrency(summary.netWorth)}
                                    accent="slate"
                                    subtitle={netWorthSubtitle}
                                />
                                {summary.balanceSource === 'accounts' && (
                                    <StatCard
                                        label="In Accounts"
                                        value={formatCurrency(summary.totalAccountBalance)}
                                        accent="cyan"
                                        subtitle="Sum of all account balances"
                                    />
                                )}
                            </div>
                        </>
                    )
                }}
            </AsyncContent>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <QuickLink to="/transactions" title="Transactions" description="View and manage income & expenses" />
                <QuickLink to="/transactions?type=income" title="Income" description="Filter to income entries" />
                <QuickLink to="/accounts" title="Accounts" description="View and manage your accounts" />
            </div>
        </div>
    )
}

interface StatCardProps {
    label: string
    value: string
    subtitle?: string
    accent: 'cyan' | 'rose' | 'violet' | 'slate'
}

const accentClasses: Record<StatCardProps['accent'], string> = {
    cyan: 'border-cyan-500/20 bg-cyan-500/5',
    rose: 'border-rose-500/20 bg-rose-500/5',
    violet: 'border-violet-500/20 bg-violet-500/5',
    slate: 'border-slate-700 bg-slate-900/40',
}

const StatCard: React.FC<StatCardProps> = ({ label, value, subtitle, accent }) => (
    <div className={`card ${accentClasses[accent]}`}>
        <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold text-slate-100 mt-2">{value}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
)

interface QuickLinkProps {
    to: string
    title: string
    description: string
}

const QuickLink: React.FC<QuickLinkProps> = ({ to, title, description }) => (
    <Link
        to={to}
        className="card hover:border-cyan-500/30 transition-colors group"
    >
        <p className="text-sm font-medium text-slate-200 group-hover:text-cyan-300">{title}</p>
        <p className="text-xs text-slate-500 mt-1">{description}</p>
    </Link>
)

export default Home
