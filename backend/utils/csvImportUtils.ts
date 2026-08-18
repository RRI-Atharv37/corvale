import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { CSV_HEADERS } from './transactionUtils'

export const IMPORT_MAX_ROWS = 2000
export const IMPORT_PREVIEW_SAMPLE_ROWS = 5

export type ImportFormat = 'generic' | 'chase' | 'spndr_export' | 'ofx'

export type ColumnMappingField =
    | 'date'
    | 'description'
    | 'amount'
    | 'debit'
    | 'credit'
    | 'type'

export interface ColumnMapping {
    date?: string
    description?: string
    amount?: string
    debit?: string
    credit?: string
    type?: string
}

export interface ParsedImportRow {
    rowIndex: number
    date: string
    title: string
    description?: string
    amount: number
    type: 'income' | 'expense'
}

export interface ImportRowError {
    rowIndex: number
    message: string
}

const normalizeHeader = (header: string): string =>
    header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')

const CHASE_HEADERS = new Set([
    'transaction_date',
    'post_date',
    'description',
    'category',
    'type',
    'amount',
    'memo',
])

const SPNDR_EXPORT_HEADERS = CSV_HEADERS.map((header) => normalizeHeader(header))

export const isOfxContent = (content: string): boolean => {
    const trimmed = content.trimStart()
    return trimmed.startsWith('OFXHEADER:') || trimmed.includes('<OFX>') || trimmed.includes('<STMTTRN>')
}

export const parseCsvLine = (line: string): string[] => {
    const fields: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i]
        const next = line[i + 1]

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"'
                i += 1
            } else {
                inQuotes = !inQuotes
            }
            continue
        }

        if (char === ',' && !inQuotes) {
            fields.push(current)
            current = ''
            continue
        }

        current += char
    }

    fields.push(current)
    return fields.map((field) => field.trim())
}

export const parseCsvContent = (content: string): { headers: string[]; rows: string[][] } => {
    const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = normalized.split('\n').filter((line) => line.trim().length > 0)

    if (lines.length === 0) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.EMPTY_FILE, 400)
    }

    const headers = parseCsvLine(lines[0])
    if (headers.length === 0 || headers.every((header) => header.length === 0)) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.MISSING_HEADERS, 400)
    }

    const rows = lines.slice(1).map((line) => parseCsvLine(line))
    return { headers, rows }
}

export const detectImportFormat = (headers: string[]): ImportFormat => {
    const normalized = headers.map(normalizeHeader)

    if (normalized.every((header, index) => header === SPNDR_EXPORT_HEADERS[index])) {
        return 'spndr_export'
    }

    const normalizedSet = new Set(normalized)
    const chaseMatches = [...CHASE_HEADERS].filter((header) => normalizedSet.has(header)).length
    if (chaseMatches >= 5) {
        return 'chase'
    }

    return 'generic'
}

const findHeader = (headers: string[], candidates: string[]): string | undefined => {
    const normalizedHeaders = headers.map((header) => ({
        original: header,
        normalized: normalizeHeader(header),
    }))

    for (const candidate of candidates) {
        const match = normalizedHeaders.find((header) => header.normalized === candidate)
        if (match) {
            return match.original
        }
    }

    return undefined
}

export const suggestColumnMapping = (headers: string[], format: ImportFormat): ColumnMapping => {
    if (format === 'spndr_export') {
        return {
            date: findHeader(headers, ['date']),
            description: findHeader(headers, ['title', 'description']),
            amount: findHeader(headers, ['amount']),
            type: findHeader(headers, ['type']),
        }
    }

    if (format === 'chase') {
        return {
            date: findHeader(headers, ['transaction_date', 'post_date', 'date']),
            description: findHeader(headers, ['description', 'memo']),
            amount: findHeader(headers, ['amount']),
            type: findHeader(headers, ['type']),
        }
    }

    const dateHeader = findHeader(headers, [
        'date',
        'transaction_date',
        'post_date',
        'posted_date',
        'trans_date',
    ])
    const descriptionHeader = findHeader(headers, [
        'description',
        'memo',
        'details',
        'narration',
        'payee',
        'name',
    ])
    const amountHeader = findHeader(headers, ['amount', 'transaction_amount', 'value'])
    const debitHeader = findHeader(headers, ['debit', 'withdrawal', 'withdrawals', 'money_out'])
    const creditHeader = findHeader(headers, ['credit', 'deposit', 'deposits', 'money_in'])
    const typeHeader = findHeader(headers, ['type', 'transaction_type', 'dr_cr'])

    if (amountHeader) {
        return {
            date: dateHeader,
            description: descriptionHeader,
            amount: amountHeader,
            type: typeHeader,
        }
    }

    return {
        date: dateHeader,
        description: descriptionHeader,
        debit: debitHeader,
        credit: creditHeader,
        type: typeHeader,
    }
}

const parseDateValue = (value: string): Date | null => {
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
        const parsed = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00.000Z`)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (slashMatch) {
        let year = Number(slashMatch[3])
        if (year < 100) {
            year += year >= 70 ? 1900 : 2000
        }
        const month = Number(slashMatch[1])
        const day = Number(slashMatch[2])
        const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const parseAmountValue = (value: string): number | null => {
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }

    const normalized = trimmed.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
    const amount = Number(normalized)
    if (!Number.isFinite(amount)) {
        return null
    }
    return Math.abs(amount)
}

const inferTypeFromSignedAmount = (signedAmount: number): 'income' | 'expense' => {
    return signedAmount >= 0 ? 'income' : 'expense'
}

const inferTypeFromText = (value: string | undefined): 'income' | 'expense' | null => {
    if (!value) {
        return null
    }

    const normalized = value.trim().toLowerCase()
    if (
        ['credit', 'deposit', 'income', 'payment received', 'refund'].some((token) =>
            normalized.includes(token)
        )
    ) {
        return 'income'
    }
    if (
        ['debit', 'withdrawal', 'expense', 'sale', 'purchase', 'fee', 'payment'].some((token) =>
            normalized.includes(token)
        )
    ) {
        return 'expense'
    }
    return null
}

const getCellValue = (headers: string[], row: string[], column?: string): string => {
    if (!column) {
        return ''
    }
    const index = headers.indexOf(column)
    if (index === -1) {
        return ''
    }
    return row[index] ?? ''
}

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10)

export const mapCsvRows = (
    headers: string[],
    rows: string[][],
    mapping: ColumnMapping
): { rows: ParsedImportRow[]; errors: ImportRowError[] } => {
    if (!mapping.date) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.DATE_COLUMN_REQUIRED, 400)
    }
    if (!mapping.description && !mapping.amount && !mapping.debit && !mapping.credit) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.MAPPING_INCOMPLETE, 400)
    }

    const parsedRows: ParsedImportRow[] = []
    const errors: ImportRowError[] = []

    rows.forEach((row, index) => {
        const rowIndex = index + 1
        if (row.every((cell) => cell.trim().length === 0)) {
            return
        }

        const dateValue = getCellValue(headers, row, mapping.date)
        const parsedDate = parseDateValue(dateValue)
        if (!parsedDate) {
            errors.push({ rowIndex, message: 'Invalid or missing date' })
            return
        }

        const description =
            getCellValue(headers, row, mapping.description) ||
            getCellValue(headers, row, mapping.type) ||
            'Imported transaction'
        const title = description.trim().slice(0, 200) || 'Imported transaction'

        let amount: number | null = null
        let type: 'income' | 'expense' | null = inferTypeFromText(getCellValue(headers, row, mapping.type))

        if (mapping.amount) {
            const rawAmount = getCellValue(headers, row, mapping.amount)
            const signed = Number(rawAmount.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'))
            if (!Number.isFinite(signed) || signed === 0) {
                errors.push({ rowIndex, message: 'Invalid or zero amount' })
                return
            }
            amount = Math.abs(signed)
            if (!type) {
                type = inferTypeFromSignedAmount(signed)
            }
        } else {
            const debitRaw = getCellValue(headers, row, mapping.debit)
            const creditRaw = getCellValue(headers, row, mapping.credit)
            const debit = parseAmountValue(debitRaw)
            const credit = parseAmountValue(creditRaw)

            if (debit && credit) {
                errors.push({ rowIndex, message: 'Row has both debit and credit values' })
                return
            }
            if (debit) {
                amount = debit
                type = type ?? 'expense'
            } else if (credit) {
                amount = credit
                type = type ?? 'income'
            } else {
                errors.push({ rowIndex, message: 'Missing debit or credit amount' })
                return
            }
        }

        if (!amount || amount <= 0) {
            errors.push({ rowIndex, message: 'Invalid amount' })
            return
        }

        parsedRows.push({
            rowIndex,
            date: toIsoDate(parsedDate),
            title,
            description: description.trim() || undefined,
            amount,
            type: type ?? 'expense',
        })
    })

    return { rows: parsedRows, errors }
}

const extractOfxTag = (block: string, tag: string): string | undefined => {
    const regex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i')
    const match = block.match(regex)
    return match?.[1]?.trim()
}

export const parseOfxContent = (content: string): ParsedImportRow[] => {
    const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) ?? []
    if (blocks.length === 0) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.INVALID_OFX, 400)
    }

    const rows: ParsedImportRow[] = []

    blocks.forEach((block, index) => {
        const rowIndex = index + 1
        const amountRaw = extractOfxTag(block, 'TRNAMT')
        const dateRaw = extractOfxTag(block, 'DTPOSTED') ?? extractOfxTag(block, 'DTUSER')
        const name = extractOfxTag(block, 'NAME') ?? extractOfxTag(block, 'MEMO') ?? 'Imported transaction'
        const memo = extractOfxTag(block, 'MEMO')

        if (!amountRaw || !dateRaw) {
            return
        }

        const signed = Number(amountRaw.replace(/,/g, ''))
        if (!Number.isFinite(signed) || signed === 0) {
            return
        }

        const year = dateRaw.slice(0, 4)
        const month = dateRaw.slice(4, 6)
        const day = dateRaw.slice(6, 8)
        const parsedDate = new Date(`${year}-${month}-${day}T12:00:00.000Z`)
        if (Number.isNaN(parsedDate.getTime())) {
            return
        }

        rows.push({
            rowIndex,
            date: toIsoDate(parsedDate),
            title: name.trim().slice(0, 200) || 'Imported transaction',
            description: memo?.trim() || undefined,
            amount: Math.abs(signed),
            type: inferTypeFromSignedAmount(signed),
        })
    })

    if (rows.length === 0) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.INVALID_OFX, 400)
    }

    return rows
}

export const assertImportRowLimit = (count: number): void => {
    if (count > IMPORT_MAX_ROWS) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.TOO_MANY_ROWS, 400)
    }
}

export const parseImportMapping = (value: unknown): ColumnMapping => {
    if (!value || typeof value !== 'object') {
        throw new CustomError(ERROR_MESSAGES.IMPORT.MAPPING_INCOMPLETE, 400)
    }

    const mapping = value as Record<string, unknown>
    const result: ColumnMapping = {}

    for (const field of ['date', 'description', 'amount', 'debit', 'credit', 'type'] as const) {
        const raw = mapping[field]
        if (raw === undefined || raw === null || raw === '') {
            continue
        }
        result[field] = String(raw)
    }

    return result
}

/** Normalize description text for duplicate fingerprinting. */
export const normalizeImportDescription = (title: string, description?: string): string => {
    const combined = [title, description].filter(Boolean).join(' ')
    return combined
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
}

/** Build a duplicate-detection fingerprint from date, amount (minor units), and description. */
export const buildImportFingerprint = (
    date: string,
    amountMinor: number,
    title: string,
    description?: string
): string => {
    const normalizedDesc = normalizeImportDescription(title, description)
    return `${date}|${amountMinor}|${normalizedDesc}`
}

export const toImportIsoDate = (date: Date): string => date.toISOString().slice(0, 10)

export type ImportDuplicateAction = 'skip' | 'import' | 'merge'

export interface ImportDuplicateMatch {
    transactionId: string
    title: string
    date: string
    amount: number
    categoryName?: string
}

export const parseImportRowDecisions = (
    value: unknown
): Map<number, ImportDuplicateAction> => {
    const decisions = new Map<number, ImportDuplicateAction>()
    if (!value || typeof value !== 'object') {
        return decisions
    }

    const allowed: ImportDuplicateAction[] = ['skip', 'import', 'merge']
    for (const [rawRowIndex, rawAction] of Object.entries(value as Record<string, unknown>)) {
        const rowIndex = Number(rawRowIndex)
        if (!Number.isInteger(rowIndex) || rowIndex < 1) {
            continue
        }
        if (typeof rawAction === 'string' && allowed.includes(rawAction as ImportDuplicateAction)) {
            decisions.set(rowIndex, rawAction as ImportDuplicateAction)
        }
    }

    return decisions
}
