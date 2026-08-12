const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export const DEFAULT_TIMEZONE = 'UTC'

export const isValidTimezone = (timezone: string): boolean => {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone })
        return true
    } catch {
        return false
    }
}

const getTimezoneOffsetMs = (date: Date, timezone: string): number => {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }))
    return tzDate.getTime() - utcDate.getTime()
}

const parseDateOnly = (dateStr: string): { year: number; month: number; day: number } => {
    if (!DATE_ONLY_PATTERN.test(dateStr)) {
        throw new Error('Invalid date format')
    }

    const [year, month, day] = dateStr.split('-').map(Number)
    const probe = new Date(Date.UTC(year, month - 1, day))

    if (
        probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() !== month - 1 ||
        probe.getUTCDate() !== day
    ) {
        throw new Error('Invalid date format')
    }

    return { year, month, day }
}

/** Start of day in the user's timezone, returned as UTC Date for MongoDB queries. */
export const startOfDayInTimezone = (dateStr: string, timezone: string): Date => {
    const { year, month, day } = parseDateOnly(dateStr)
    const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
    const offset = getTimezoneOffsetMs(utcMidnight, timezone)
    return new Date(utcMidnight.getTime() - offset)
}

/** End of day in the user's timezone, returned as UTC Date for MongoDB queries. */
export const endOfDayInTimezone = (dateStr: string, timezone: string): Date => {
    const { year, month, day } = parseDateOnly(dateStr)
    const utcEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
    const offset = getTimezoneOffsetMs(utcEnd, timezone)
    return new Date(utcEnd.getTime() - offset)
}

export const resolveDateRange = (
    startDate: string,
    endDate: string,
    timezone: string
): { start: Date; end: Date } => {
    const start = startOfDayInTimezone(startDate, timezone)
    const end = endOfDayInTimezone(endDate, timezone)

    if (start > end) {
        throw new Error('startDate must be on or before endDate')
    }

    return { start, end }
}
