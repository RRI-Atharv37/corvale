export const DATE_FORMATS = ['dd/mm/yy', 'yy/mm/dd', 'mm/dd/yy'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const DEFAULT_DATE_FORMAT: DateFormat = 'mm/dd/yy'

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
    { value: 'dd/mm/yy', label: 'DD/MM/YY (15/01/26)' },
    { value: 'yy/mm/dd', label: 'YY/MM/DD (26/01/15)' },
    { value: 'mm/dd/yy', label: 'MM/DD/YY (01/15/26)' },
]

export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 15, 20, 25, 50] as const
