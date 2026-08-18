import { CustomError } from './customError'

export const DATE_FORMATS = ['dd/mm/yy', 'yy/mm/dd', 'mm/dd/yy'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const DEFAULT_DATE_FORMAT: DateFormat = 'mm/dd/yy'

export const DEFAULT_PAGE_SIZE = 10
export const MIN_PAGE_SIZE = 5
export const MAX_PAGE_SIZE = 50
export const PAGE_SIZE_OPTIONS = [10, 15, 20, 25, 50] as const

export const parseDateFormat = (value: unknown): DateFormat => {
    if (typeof value !== 'string' || !DATE_FORMATS.includes(value as DateFormat)) {
        throw new CustomError(
            `Invalid date format. Must be one of: ${DATE_FORMATS.join(', ')}`,
            400
        )
    }

    return value as DateFormat
}

export const parsePageSize = (value: unknown): number => {
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        if (!Number.isInteger(parsed)) {
            throw new CustomError(
                `Invalid page size. Must be an integer between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`,
                400
            )
        }
        return parsePageSize(parsed)
    }

    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new CustomError(
            `Invalid page size. Must be an integer between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`,
            400
        )
    }

    if (value < MIN_PAGE_SIZE || value > MAX_PAGE_SIZE) {
        throw new CustomError(
            `Invalid page size. Must be between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`,
            400
        )
    }

    return value
}
