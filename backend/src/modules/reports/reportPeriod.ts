import { CustomError } from '@core/errors/customError'
import { DEFAULT_TIMEZONE, resolveDateRange } from '@core/time/timezoneUtils'
import { resolveMonthlyPeriod } from '@modules/budgets/budgetUtils'
import { parseDashboardDateRange } from '@modules/dashboard/dashboardUtils'

export const REPORT_PERIOD_TYPES = ['monthly', 'yearly', 'custom'] as const
export type ReportPeriodType = (typeof REPORT_PERIOD_TYPES)[number]

export interface ReportPeriod {
    periodType: ReportPeriodType
    periodStart: Date
    periodEnd: Date
    startDate: string
    endDate: string
}

const padMonth = (month: number): string => String(month).padStart(2, '0')

export const parseReportPeriodType = (value: unknown): ReportPeriodType => {
    if (typeof value !== 'string' || !REPORT_PERIOD_TYPES.includes(value as ReportPeriodType)) {
        throw new CustomError(
            `Invalid periodType. Must be one of: ${REPORT_PERIOD_TYPES.join(', ')}`,
            400
        )
    }
    return value as ReportPeriodType
}

export const resolveReportPeriod = (
    query: Record<string, unknown>,
    timezone?: string
): ReportPeriod => {
    const resolvedTimezone = timezone?.trim() || DEFAULT_TIMEZONE
    const periodType = parseReportPeriodType(query.periodType ?? 'custom')

    if (periodType === 'monthly') {
        const year = Number(query.year)
        const month = Number(query.month)
        if (!Number.isInteger(year) || !Number.isInteger(month)) {
            throw new CustomError('Monthly reports require year and month query params', 400)
        }
        const { periodStart, periodEnd } = resolveMonthlyPeriod(year, month, resolvedTimezone)
        const startDate = `${year}-${padMonth(month)}-01`
        const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
        const endDate = `${year}-${padMonth(month)}-${String(endDay).padStart(2, '0')}`
        return { periodType, periodStart, periodEnd, startDate, endDate }
    }

    if (periodType === 'yearly') {
        const year = Number(query.year)
        if (!Number.isInteger(year)) {
            throw new CustomError('Yearly reports require year query param', 400)
        }
        const startDate = `${year}-01-01`
        const endDate = `${year}-12-31`
        const { start: periodStart, end: periodEnd } = resolveDateRange(
            startDate,
            endDate,
            resolvedTimezone
        )
        return { periodType, periodStart, periodEnd, startDate, endDate }
    }

    const { periodStart, periodEnd, startDate, endDate } = parseDashboardDateRange(
        typeof query.startDate === 'string' ? query.startDate : undefined,
        typeof query.endDate === 'string' ? query.endDate : undefined,
        resolvedTimezone
    )
    return { periodType, periodStart, periodEnd, startDate, endDate }
}
