import React, { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import { IoBookmark, IoPlay, IoTrash } from 'react-icons/io5'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import type {
    ApiResponse,
    CustomReportChartType,
    CustomReportDataType,
    CustomReportQueryResult,
    CustomReportSplitBy,
    DashboardGroupBy,
    ReportPeriodType,
    SavedReport,
    SavedReportRunResult,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency } from '../../utils/format'
import {
    axisTick,
    barChartTooltipProps,
    CHART_CATEGORY_COLORS,
    CHART_COLORS,
    chartMargin,
    chartTooltipProps,
    formatChartCurrency,
    formatPeriodLabel,
    yAxisTick,
} from '../dashboard/chartTheme'

interface CustomReportBuilderProps {
    periodType: ReportPeriodType
    reportYear: string
    reportMonth: string
    startDate: string
    endDate: string
    savedReports: SavedReport[]
    onSavedReportsChange: () => void
}

const SPLIT_OPTIONS: { value: CustomReportSplitBy; label: string }[] = [
    { value: 'total', label: 'Total' },
    { value: 'time', label: 'Over time' },
    { value: 'category', label: 'Category' },
    { value: 'paymentMethod', label: 'Payment type' },
]

const CHART_OPTIONS: { value: CustomReportChartType; label: string }[] = [
    { value: 'table', label: 'Table' },
    { value: 'bar', label: 'Bar' },
    { value: 'line', label: 'Line' },
    { value: 'area', label: 'Area' },
    { value: 'donut', label: 'Donut' },
]

const CustomReportBuilder: React.FC<CustomReportBuilderProps> = ({
    periodType,
    reportYear,
    reportMonth,
    startDate,
    endDate,
    savedReports,
    onSavedReportsChange,
}) => {
    const [splitBy, setSplitBy] = useState<CustomReportSplitBy>('category')
    const [chartType, setChartType] = useState<CustomReportChartType>('bar')
    const [dataType, setDataType] = useState<CustomReportDataType>('expense')
    const [groupBy, setGroupBy] = useState<DashboardGroupBy>('month')
    const [reportName, setReportName] = useState('')
    const [result, setResult] = useState<CustomReportQueryResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    const periodParams = useMemo(() => {
        if (periodType === 'monthly') {
            return { periodType, year: reportYear, month: reportMonth }
        }
        if (periodType === 'yearly') {
            return { periodType, year: reportYear }
        }
        return { periodType, startDate, endDate }
    }, [periodType, reportYear, reportMonth, startDate, endDate])

    const valueKey = dataType === 'income' ? 'income' : dataType === 'expense' ? 'expense' : 'total'

    const runQuery = async () => {
        setLoading(true)
        try {
            const response = await axiosInstance.post<ApiResponse<CustomReportQueryResult>>(
                API_PATHS.REPORTS.QUERY,
                { splitBy, chartType, dataType, groupBy, ...periodParams }
            )
            setResult(unwrapApiData(response))
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to run custom report'))
        } finally {
            setLoading(false)
        }
    }

    const saveReport = async () => {
        if (!reportName.trim()) {
            toast.error('Enter a name for this report')
            return
        }
        setSaving(true)
        try {
            await axiosInstance.post(API_PATHS.REPORTS.SAVED, {
                name: reportName.trim(),
                splitBy,
                chartType,
                dataType,
                groupBy,
                ...periodParams,
            })
            toast.success('Report saved')
            setReportName('')
            onSavedReportsChange()
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to save report'))
        } finally {
            setSaving(false)
        }
    }

    const runSavedReport = async (reportId: string) => {
        setLoading(true)
        try {
            const response = await axiosInstance.get<ApiResponse<SavedReportRunResult>>(
                API_PATHS.REPORTS.SAVED_RUN(reportId)
            )
            const payload = unwrapApiData(response)
            setResult(payload.result)
            setSplitBy(payload.config.splitBy)
            setChartType(payload.config.chartType)
            setDataType(payload.config.dataType)
            if (payload.config.groupBy) {
                setGroupBy(payload.config.groupBy)
            }
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to run saved report'))
        } finally {
            setLoading(false)
        }
    }

    const deleteSavedReport = async (reportId: string) => {
        try {
            await axiosInstance.delete(`${API_PATHS.REPORTS.SAVED}/${reportId}`)
            toast.success('Saved report removed')
            onSavedReportsChange()
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to delete saved report'))
        }
    }

    const chartData = useMemo(() => {
        if (!result) return []
        return result.rows.map((row) => ({
            ...row,
            label:
                result.splitBy === 'time'
                    ? formatPeriodLabel(row.label, result.groupBy ?? 'month')
                    : row.label,
            value: row[valueKey],
        }))
    }, [result, valueKey])

    return (
        <div className="card space-y-4">
            <div>
                <h3 className="text-sm font-medium text-fg">Custom reports</h3>
                <p className="text-xs text-fg-muted mt-1">
                    Build visual reports by split, chart type, and date range - save configs to reuse
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <SelectField
                    label="Split by"
                    value={splitBy}
                    onChange={(value) => setSplitBy(value as CustomReportSplitBy)}
                    options={SPLIT_OPTIONS}
                />
                <SelectField
                    label="Chart type"
                    value={chartType}
                    onChange={(value) => setChartType(value as CustomReportChartType)}
                    options={CHART_OPTIONS}
                />
                <SelectField
                    label="Data"
                    value={dataType}
                    onChange={(value) => setDataType(value as CustomReportDataType)}
                    options={[
                        { value: 'expense', label: 'Expenses' },
                        { value: 'income', label: 'Income' },
                        { value: 'both', label: 'Both' },
                    ]}
                    disabled={splitBy === 'paymentMethod'}
                />
                {splitBy === 'time' && (
                    <SelectField
                        label="Time grouping"
                        value={groupBy}
                        onChange={(value) => setGroupBy(value as DashboardGroupBy)}
                        options={[
                            { value: 'day', label: 'Daily' },
                            { value: 'week', label: 'Weekly' },
                            { value: 'month', label: 'Monthly' },
                        ]}
                    />
                )}
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={runQuery}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent-subtle text-accent border border-accent/30 hover:bg-accent-subtle disabled:opacity-50"
                >
                    <IoPlay size={16} />
                    {loading ? 'Running...' : 'Run report'}
                </button>
                <input
                    type="text"
                    value={reportName}
                    onChange={(event) => setReportName(event.target.value)}
                    placeholder="Report name to save"
                    className="flex-1 min-w-[180px] rounded-lg border border-border bg-surface/80 px-3 py-2 text-sm text-fg outline-none focus:border-accent/40"
                />
                <button
                    type="button"
                    onClick={saveReport}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border text-fg-secondary hover:border-accent/40 hover:text-accent disabled:opacity-50"
                >
                    <IoBookmark size={16} />
                    {saving ? 'Saving...' : 'Save report'}
                </button>
            </div>

            {savedReports.length > 0 && (
                <div>
                    <p className="text-xs text-fg-muted mb-2">Saved reports</p>
                    <ul className="divide-y divide-slate-800 rounded-lg border border-border-subtle">
                        {savedReports.map((report) => (
                            <li
                                key={report._id}
                                className="flex items-center justify-between gap-3 px-3 py-2.5"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm text-fg truncate">{report.name}</p>
                                    <p className="text-[10px] text-fg-muted capitalize">
                                        {report.config.chartType} · {report.config.splitBy} ·{' '}
                                        {report.config.dataType}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => runSavedReport(report._id)}
                                        className="p-1.5 rounded text-accent hover:bg-accent-subtle"
                                        title="Run"
                                    >
                                        <IoPlay size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => deleteSavedReport(report._id)}
                                        className="p-1.5 rounded text-expense hover:bg-expense/10"
                                        title="Delete"
                                    >
                                        <IoTrash size={14} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {result && (
                <div className="pt-2">
                    <p className="text-xs text-fg-muted mb-3">
                        {result.periodStart} to {result.periodEnd} · {result.rows.length} rows
                    </p>
                    {chartType === 'table' ? (
                        <ReportTable rows={result.rows} dataType={result.dataType} />
                    ) : chartType === 'donut' ? (
                        <div className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={chartData}
                                        dataKey="value"
                                        nameKey="label"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={55}
                                        outerRadius={90}
                                        paddingAngle={2}
                                    >
                                        {chartData.map((_, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={CHART_CATEGORY_COLORS[index % CHART_CATEGORY_COLORS.length]}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip {...chartTooltipProps} formatter={(value: number) => formatCurrency(value)} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : chartType === 'area' ? (
                        <div className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={chartMargin}>
                                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                                    <YAxis tick={yAxisTick} axisLine={false} tickLine={false} tickFormatter={formatChartCurrency} width={52} />
                                    <Tooltip {...chartTooltipProps} formatter={(value: number) => formatCurrency(value)} />
                                    <Area type="monotone" dataKey="value" stroke={CHART_COLORS.expense} fill={CHART_COLORS.expense} fillOpacity={0.2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    ) : chartType === 'line' ? (
                        <div className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={chartMargin}>
                                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                                    <YAxis tick={yAxisTick} axisLine={false} tickLine={false} tickFormatter={formatChartCurrency} width={52} />
                                    <Tooltip {...chartTooltipProps} formatter={(value: number) => formatCurrency(value)} />
                                    <Line type="monotone" dataKey="value" stroke={CHART_COLORS.income} strokeWidth={2} dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={chartMargin}>
                                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                                    <YAxis tick={yAxisTick} axisLine={false} tickLine={false} tickFormatter={formatChartCurrency} width={52} />
                                    <Tooltip {...barChartTooltipProps} formatter={(value: number) => formatCurrency(value)} />
                                    <Bar dataKey="value" fill={CHART_COLORS.expense} radius={[4, 4, 0, 0]} maxBarSize={48} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

const ReportTable: React.FC<{
    rows: CustomReportQueryResult['rows']
    dataType: CustomReportDataType
}> = ({ rows, dataType }) => (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
            <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-fg-muted">
                    <th className="px-3 py-2">Label</th>
                    {(dataType === 'income' || dataType === 'both') && <th className="px-3 py-2">Income</th>}
                    {(dataType === 'expense' || dataType === 'both') && <th className="px-3 py-2">Expense</th>}
                    <th className="px-3 py-2">Total</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.label} className="border-b border-border-subtle/60">
                        <td className="px-3 py-2 text-fg">{row.label}</td>
                        {(dataType === 'income' || dataType === 'both') && (
                            <td className="px-3 py-2 text-accent">{formatCurrency(row.income)}</td>
                        )}
                        {(dataType === 'expense' || dataType === 'both') && (
                            <td className="px-3 py-2 text-expense">{formatCurrency(row.expense)}</td>
                        )}
                        <td className="px-3 py-2 text-fg-secondary">{formatCurrency(row.total)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
)

interface SelectFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    options: { value: string; label: string }[]
    disabled?: boolean
}

const SelectField: React.FC<SelectFieldProps> = ({ label, value, onChange, options, disabled }) => (
    <label className="block">
        <span className="text-xs text-fg-muted">{label}</span>
        <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            className="mt-1 w-full rounded-lg border border-border bg-surface/80 px-3 py-2 text-sm text-fg outline-none focus:border-accent/40 disabled:opacity-50"
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    </label>
)

export default CustomReportBuilder
