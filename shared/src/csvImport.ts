/**
 * CSV/OFX/QIF bank statement import: parsing, format detection, column mapping,
 * row mapping and duplicate-detection fingerprinting. Extracted verbatim
 * from `backend/utils/csvImportUtils.ts` (Sprint 13.10) so the frontend can
 * run the same import pipeline entirely client-side while offline.
 *
 * Throws plain `Error` (not a backend `CustomError`) — every call site on
 * the backend must catch and translate to `CustomError(message, 400)` to
 * preserve existing API behavior (every import error in the original
 * module was a 400). See `backend/utils/csvImportUtils.ts`'s `withImportError`.
 */

export const IMPORT_MAX_ROWS = 2000
export const IMPORT_PREVIEW_SAMPLE_ROWS = 5

/**
 * `'spndr_export'` is the pre-rename spelling of `'corvale_export'`. It stays a valid
 * `ImportFormat` (V7.3c rename-compat shim): `detectImportFormat` only ever returns the new
 * tag, but `suggestColumnMapping` still resolves the legacy one identically, so an older build
 * anywhere in the pipeline that produces/expects `'spndr_export'` keeps working and every CSV a
 * tester exported before the rename still imports. Removes the backend/frontend atomic-deploy
 * constraint entirely. Safe to drop one release after v1.0.0. See ROADMAP's V7 compat matrix.
 */
export type ImportFormat = 'generic' | 'chase' | 'corvale_export' | 'spndr_export' | 'ofx' | 'qif'

export type ColumnMappingField =
    | 'date'
    | 'description'
    | 'amount'
    | 'debit'
    | 'credit'
    | 'type'

/**
 * Token order for slash/dot/dash-separated dates in the mapped date column (BUG-18). `auto`
 * inspects the column and picks an order; the explicit values force it. ISO `YYYY-MM-DD` is
 * always recognised first, regardless of this setting.
 */
export type ImportDateFormat = 'auto' | 'YMD' | 'MDY' | 'DMY'

const DATE_FORMATS: readonly ImportDateFormat[] = ['auto', 'YMD', 'MDY', 'DMY']

/**
 * Field separators a delimited-text export may use (BUG-19). Comma is the historical default and
 * the tie-breaker; `parseCsvContent` sniffs the header line when no delimiter is supplied.
 */
export const IMPORT_DELIMITERS = [',', ';', '\t', '|'] as const
export type ImportDelimiter = (typeof IMPORT_DELIMITERS)[number]

export interface ColumnMapping {
    date?: string
    description?: string
    amount?: string
    debit?: string
    credit?: string
    type?: string
    dateFormat?: ImportDateFormat
}

export interface ParsedImportRow {
    rowIndex: number
    date: string
    title: string
    description?: string
    amount: number
    type: 'income' | 'expense'
    /**
     * A stable per-transaction id supplied by the source file (OFX `FITID`). When present it is
     * an exact dedupe key — `backend/controllers/importController.ts` matches it against
     * `Transaction.externalId` before falling back to the fuzzy date/amount/description
     * fingerprint (BUG-21).
     */
    externalId?: string
}

export interface ImportRowError {
    rowIndex: number
    message: string
}

/** Shape returned by the OFX and QIF parsers (BUG-21 / BUG-23): rows plus surfaced skip reasons. */
export interface ParsedStatementResult {
    rows: ParsedImportRow[]
    errors: ImportRowError[]
    /** `<CURDEF>` for OFX; absent for QIF (the format carries no currency). Informational only. */
    statementCurrency?: string
}

const IMPORT_TITLE_MAX = 200
const IMPORT_DESCRIPTION_MAX = 2000
const IMPORT_EXTERNAL_ID_MAX = 256

/**
 * Validate a client-supplied `parsedRows` array (SEC-52). The OFX/QIF parse step returns clean
 * rows, but the commit/preview call takes that array straight back from the client, so it is
 * untrusted: `type` must be the transaction income/expense enum (a stray `"transfer"` would
 * create an orphan transfer leg), `date` an ISO `YYYY-MM-DD`, `title` non-empty, `amount` a
 * finite positive number. Throws a plain `Error` on the first bad row — the backend translates
 * it to a 400, as with every other error out of this module.
 */
export const sanitizeParsedImportRows = (value: unknown): ParsedImportRow[] => {
    if (!Array.isArray(value)) {
        throw new Error('Parsed rows must be an array')
    }

    return value.map((raw, index) => {
        const label = `Row ${index + 1}`
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`${label} is not a valid import row`)
        }
        const row = raw as Record<string, unknown>

        const date = typeof row.date === 'string' ? row.date.trim() : ''
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
            throw new Error(`${label} has an invalid date`)
        }

        const title = typeof row.title === 'string' ? row.title.trim() : ''
        if (!title) {
            throw new Error(`${label} has no title`)
        }

        const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount)
        if (typeof row.amount !== 'number' && typeof row.amount !== 'string') {
            throw new Error(`${label} has an invalid amount`)
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error(`${label} has an invalid amount`)
        }

        if (row.type !== 'income' && row.type !== 'expense') {
            throw new Error(`${label} has an invalid type`)
        }

        const description =
            typeof row.description === 'string' && row.description.trim()
                ? row.description.trim().slice(0, IMPORT_DESCRIPTION_MAX)
                : undefined

        const externalId =
            typeof row.externalId === 'string' && row.externalId.trim()
                ? row.externalId.trim().slice(0, IMPORT_EXTERNAL_ID_MAX)
                : undefined

        const rowIndex =
            typeof row.rowIndex === 'number' && Number.isFinite(row.rowIndex)
                ? row.rowIndex
                : index + 1

        return {
            rowIndex,
            date,
            title: title.slice(0, IMPORT_TITLE_MAX),
            description,
            amount,
            type: row.type,
            externalId,
        }
    })
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

/**
 * Mirrors `backend/utils/transactionUtils.ts`'s `CSV_HEADERS` (the Corvale
 * export column order). Duplicated as a literal here rather than imported,
 * since `transactionUtils.ts` is not itself a pure/dependency-free module.
 */
const CORVALE_CSV_HEADERS = [
    'Type',
    'Title',
    'Amount',
    'Currency',
    'Category',
    'Date',
    'Description',
    'Source',
    'Payment Method',
    'Tags',
    'Status',
]

const CORVALE_EXPORT_HEADERS = CORVALE_CSV_HEADERS.map((header) => normalizeHeader(header))

export const isOfxContent = (content: string): boolean => {
    const trimmed = content.trimStart()
    return trimmed.startsWith('OFXHEADER:') || trimmed.includes('<OFX>') || trimmed.includes('<STMTTRN>')
}

/** QIF files open with a `!Type:` / `!Account` / `!Option:` control line (BUG-23). */
export const isQifContent = (content: string): boolean => {
    for (const rawLine of content.split(/\r\n|\r|\n/)) {
        const line = rawLine.trim()
        if (!line) {
            continue
        }
        return /^!(type:|account|option:|clear:autoswitch)/i.test(line)
    }
    return false
}

/**
 * Count unquoted occurrences of each candidate delimiter in the header line and return the
 * winner; comma wins ties and the no-signal case (BUG-19).
 */
export const sniffDelimiter = (headerLine: string): ImportDelimiter => {
    const counts = new Map<ImportDelimiter, number>(IMPORT_DELIMITERS.map((d) => [d, 0]))
    let inQuotes = false
    for (let i = 0; i < headerLine.length; i += 1) {
        const char = headerLine[i]
        if (char === '"') {
            inQuotes = !inQuotes
            continue
        }
        if (inQuotes) {
            continue
        }
        if (counts.has(char as ImportDelimiter)) {
            counts.set(char as ImportDelimiter, (counts.get(char as ImportDelimiter) ?? 0) + 1)
        }
    }

    let best: ImportDelimiter = ','
    let bestCount = counts.get(',') ?? 0
    for (const delimiter of IMPORT_DELIMITERS) {
        const count = counts.get(delimiter) ?? 0
        if (count > bestCount) {
            best = delimiter
            bestCount = count
        }
    }
    return best
}

export const parseCsvLine = (line: string, delimiter: string = ','): string[] => {
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

        if (char === delimiter && !inQuotes) {
            fields.push(current)
            current = ''
            continue
        }

        current += char
    }

    fields.push(current)
    return fields.map((field) => field.trim())
}

export interface ParsedCsvContent {
    headers: string[]
    rows: string[][]
    delimiter: ImportDelimiter
}

export const parseCsvContent = (content: string, delimiter?: ImportDelimiter): ParsedCsvContent => {
    const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = normalized.split('\n').filter((line) => line.trim().length > 0)

    if (lines.length === 0) {
        throw new Error('Import file is empty')
    }

    const resolvedDelimiter =
        delimiter && IMPORT_DELIMITERS.includes(delimiter) ? delimiter : sniffDelimiter(lines[0])

    const headers = parseCsvLine(lines[0], resolvedDelimiter)
    if (headers.length === 0 || headers.every((header) => header.length === 0)) {
        throw new Error('CSV file is missing a header row')
    }

    const rows = lines.slice(1).map((line) => parseCsvLine(line, resolvedDelimiter))
    return { headers, rows, delimiter: resolvedDelimiter }
}

export const detectImportFormat = (headers: string[]): ImportFormat => {
    const normalized = headers.map(normalizeHeader)

    if (normalized.every((header, index) => header === CORVALE_EXPORT_HEADERS[index])) {
        return 'corvale_export'
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
    if (format === 'corvale_export' || format === 'spndr_export') {
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

/** A slash / dot / dash separated three-number date, e.g. `25/12/2026`, `2026.03.07`, `7-3-26`. */
const NUMERIC_DATE_RE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/

const expandTwoDigitYear = (year: number): number => {
    if (year >= 100) {
        return year
    }
    return year + (year >= 70 ? 1900 : 2000)
}

/**
 * Build a UTC date from calendar parts, rejecting anything out of range instead of letting
 * `Date.UTC` roll it forward (the BUG-18 defect: `25/12/2026` read month-first became 2028-01-12).
 */
const buildUtcDate = (year: number, month: number, day: number): Date | null => {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return null
    }
    const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    if (
        Number.isNaN(parsed.getTime()) ||
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        return null
    }
    return parsed
}

type ResolvedDateOrder = Exclude<ImportDateFormat, 'auto'>

/**
 * Pick a token order for the mapped date column. For `auto`: ISO / 4-digit-first values vote
 * `YMD`, a first token > 12 votes `DMY`, a second token > 12 votes `MDY`; on no signal (or a
 * contradiction) fall back to `MDY`, the historical default.
 */
const resolveDateOrder = (values: string[], requested: ImportDateFormat): ResolvedDateOrder => {
    if (requested && requested !== 'auto') {
        return requested
    }

    let sawDayFirst = false
    let sawMonthSecond = false
    let sawYearFirst = false

    for (const raw of values) {
        const trimmed = raw.trim()
        if (!trimmed) {
            continue
        }
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
            sawYearFirst = true
            continue
        }
        const match = trimmed.match(NUMERIC_DATE_RE)
        if (!match) {
            continue
        }
        const first = Number(match[1])
        const second = Number(match[2])
        if (match[1].length === 4) {
            sawYearFirst = true
            continue
        }
        if (first > 12 && first <= 31) {
            sawDayFirst = true
        }
        if (second > 12 && second <= 31) {
            sawMonthSecond = true
        }
    }

    if (sawDayFirst && !sawMonthSecond) {
        return 'DMY'
    }
    if (sawYearFirst && !sawDayFirst && !sawMonthSecond) {
        return 'YMD'
    }
    return 'MDY'
}

const parseDateValue = (value: string, order: ResolvedDateOrder = 'MDY'): Date | null => {
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
        const parsed = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00.000Z`)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    const numericMatch = trimmed.match(NUMERIC_DATE_RE)
    if (numericMatch) {
        const t1 = Number(numericMatch[1])
        const t2 = Number(numericMatch[2])
        const t3 = Number(numericMatch[3])

        let year: number
        let month: number
        let day: number
        if (order === 'YMD') {
            year = expandTwoDigitYear(t1)
            month = t2
            day = t3
        } else if (order === 'DMY') {
            day = t1
            month = t2
            year = expandTwoDigitYear(t3)
        } else {
            month = t1
            day = t2
            year = expandTwoDigitYear(t3)
        }
        // A numeric date that doesn't resolve is rejected outright — never fall through to
        // `new Date()`, which would guess (or roll a bad month forward) with no error (BUG-18).
        return buildUtcDate(year, month, day)
    }

    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Parse a money value from a bank export, tolerant of locale formatting (BUG-20). Both the
 * signed-amount column and the debit/credit columns run through this — the normalization used to
 * be `.replace(/[$,\s]/g, '')`, which failed any non-`$` symbol and turned European `1.234,56`
 * into `1.23456`.
 *
 * - Strips any surrounding non-numeric text: currency symbols (`$ € £ ₹ ¥`), ISO codes
 *   (`INR`, `USD`), stray spaces / NBSP, a `+`.
 * - Reads a leading `-`, a trailing `-`, or `(...)` wrapping as negative.
 * - Infers the decimal separator: with both `.` and `,` present the rightmost is the decimal and
 *   the other is grouping; a lone `,` followed by 1–2 digits is a decimal comma, otherwise `,` is
 *   grouping (covers Indian `1,00,000` clusters and `1.234.567,89` dot grouping).
 *
 * Returns the signed number, or `null` when what remains isn't a single finite number. The import
 * preview always shows the parsed result before commit, so a wrong inference is visible, not silent.
 */
export const parseImportAmount = (value: string): number | null => {
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }

    let body = trimmed
    let negative = false

    const parenMatch = body.match(/^\((.*)\)$/)
    if (parenMatch) {
        negative = true
        body = parenMatch[1].trim()
    }
    if (body.startsWith('-') || body.endsWith('-')) {
        negative = true
    }

    const digits = body.replace(/[^\d.,]/g, '')
    if (!digits) {
        return null
    }

    const hasDot = digits.includes('.')
    const hasComma = digits.includes(',')

    let normalized: string
    if (hasDot && hasComma) {
        normalized =
            digits.lastIndexOf(',') > digits.lastIndexOf('.')
                ? digits.replace(/\./g, '').replace(/,/g, '.')
                : digits.replace(/,/g, '')
    } else if (hasComma) {
        const parts = digits.split(',')
        const lastPart = parts[parts.length - 1]
        const isDecimalComma = parts.length === 2 && lastPart.length >= 1 && lastPart.length <= 2
        normalized = isDecimalComma ? `${parts[0]}.${lastPart}` : digits.replace(/,/g, '')
    } else {
        normalized = digits
    }

    if (!/\d/.test(normalized) || !/^\d*\.?\d*$/.test(normalized)) {
        return null
    }

    const amount = Number(normalized)
    if (!Number.isFinite(amount)) {
        return null
    }
    return negative ? -amount : amount
}

const parseAmountValue = (value: string): number | null => {
    const parsed = parseImportAmount(value)
    return parsed === null ? null : Math.abs(parsed)
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
        throw new Error('A date column mapping is required')
    }
    if (!mapping.description && !mapping.amount && !mapping.debit && !mapping.credit) {
        throw new Error('Column mapping is incomplete')
    }

    const parsedRows: ParsedImportRow[] = []
    const errors: ImportRowError[] = []

    const dateColumnValues = rows.map((row) => getCellValue(headers, row, mapping.date))
    const dateOrder = resolveDateOrder(dateColumnValues, mapping.dateFormat ?? 'auto')

    rows.forEach((row, index) => {
        const rowIndex = index + 1
        if (row.every((cell) => cell.trim().length === 0)) {
            return
        }

        const dateValue = getCellValue(headers, row, mapping.date)
        const parsedDate = parseDateValue(dateValue, dateOrder)
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
            const signed = parseImportAmount(rawAmount)
            if (signed === null || signed === 0) {
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

/**
 * Map an OFX `<TRNTYPE>` to income/expense. Returns `null` for the ambiguous / structural values
 * (`OTHER`, `XFER`, …) so the caller falls back to the `<TRNAMT>` sign (BUG-21).
 */
const typeFromOfxTrnType = (trnType: string | undefined): 'income' | 'expense' | null => {
    if (!trnType) {
        return null
    }
    const normalized = trnType.trim().toUpperCase()
    if (['CREDIT', 'DEP', 'DIRECTDEP', 'INT', 'DIV'].includes(normalized)) {
        return 'income'
    }
    if (
        ['DEBIT', 'ATM', 'POS', 'CHECK', 'PAYMENT', 'CASH', 'DIRECTDEBIT', 'REPEATPMT', 'SRVCHG', 'FEE'].includes(
            normalized
        )
    ) {
        return 'expense'
    }
    return null
}

export const parseOfxContent = (content: string): ParsedStatementResult => {
    const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) ?? []
    if (blocks.length === 0) {
        throw new Error('No valid transactions found in OFX file')
    }

    // `<CURDEF>` lives in the statement envelope, before the first <STMTTRN>.
    const envelope = content.split(/<STMTTRN>/i)[0] ?? content
    const statementCurrency = extractOfxTag(envelope, 'CURDEF')?.toUpperCase()

    const rows: ParsedImportRow[] = []
    const errors: ImportRowError[] = []

    blocks.forEach((block, index) => {
        const rowIndex = index + 1
        const amountRaw = extractOfxTag(block, 'TRNAMT')
        const dateRaw = extractOfxTag(block, 'DTPOSTED') ?? extractOfxTag(block, 'DTUSER')
        const name = extractOfxTag(block, 'NAME') ?? extractOfxTag(block, 'MEMO') ?? 'Imported transaction'
        const memo = extractOfxTag(block, 'MEMO')
        const fitId = extractOfxTag(block, 'FITID')
        const trnType = extractOfxTag(block, 'TRNTYPE')

        if (!amountRaw || !dateRaw) {
            errors.push({ rowIndex, message: 'Statement entry is missing an amount or date' })
            return
        }

        const signed = Number(amountRaw.replace(/,/g, ''))
        if (!Number.isFinite(signed) || signed === 0) {
            errors.push({ rowIndex, message: 'Statement entry has an invalid or zero amount' })
            return
        }

        const year = dateRaw.slice(0, 4)
        const month = dateRaw.slice(4, 6)
        const day = dateRaw.slice(6, 8)
        const parsedDate = new Date(`${year}-${month}-${day}T12:00:00.000Z`)
        if (Number.isNaN(parsedDate.getTime())) {
            errors.push({ rowIndex, message: 'Statement entry has an invalid date' })
            return
        }

        rows.push({
            rowIndex,
            date: toIsoDate(parsedDate),
            title: name.trim().slice(0, 200) || 'Imported transaction',
            description: memo?.trim() || undefined,
            amount: Math.abs(signed),
            type: typeFromOfxTrnType(trnType) ?? inferTypeFromSignedAmount(signed),
            externalId: fitId || undefined,
        })
    })

    if (rows.length === 0 && errors.length === 0) {
        throw new Error('No valid transactions found in OFX file')
    }

    return { rows, errors, statementCurrency }
}

/**
 * Parse a QIF file (BUG-23). Line-oriented: `!Type:` control lines, then transaction records
 * terminated by `^`. Fields used: `D` date, `T`/`U` amount, `P` payee, `M` memo, `N` cheque
 * number / action. `L` (category) is intentionally ignored — Corvale categorises its own way.
 */
export const parseQifContent = (content: string): ParsedStatementResult => {
    const lines = content.split(/\r\n|\r|\n/)

    interface RawRecord {
        date?: string
        amount?: string
        payee?: string
        memo?: string
        number?: string
    }

    const records: RawRecord[] = []
    let current: RawRecord = {}
    let hasCurrent = false

    for (const rawLine of lines) {
        const line = rawLine.trimEnd()
        if (!line) {
            continue
        }
        if (line.startsWith('!')) {
            // A control line (`!Type:Bank`, `!Account`, …) also terminates any open record.
            if (hasCurrent) {
                records.push(current)
                current = {}
                hasCurrent = false
            }
            continue
        }
        if (line === '^') {
            if (hasCurrent) {
                records.push(current)
            }
            current = {}
            hasCurrent = false
            continue
        }

        const code = line[0]
        const value = line.slice(1).trim()
        hasCurrent = true
        switch (code) {
            case 'D':
                current.date = value
                break
            case 'T':
            case 'U':
                // `T` and `U` carry the same value; last one wins.
                current.amount = value
                break
            case 'P':
                current.payee = value
                break
            case 'M':
                current.memo = value
                break
            case 'N':
                current.number = value
                break
            default:
                break
        }
    }
    if (hasCurrent) {
        records.push(current)
    }

    if (records.length === 0) {
        throw new Error('No valid transactions found in QIF file')
    }

    // QIF dates use `MM/DD/YYYY` or `MM/DD'YY` (Quicken uses `'` before a 2-digit year, and may
    // pad a single-digit day/month with a space). Normalise, then auto-detect the token order.
    const normalizeQifDate = (value: string): string =>
        value.replace(/'/g, '/').replace(/\s+/g, '').replace(/\./g, '/')

    const dateOrder = resolveDateOrder(
        records.map((record) => normalizeQifDate(record.date ?? '')),
        'auto'
    )

    const rows: ParsedImportRow[] = []
    const errors: ImportRowError[] = []

    records.forEach((record, index) => {
        const rowIndex = index + 1
        if (!record.date && !record.amount && !record.payee && !record.memo) {
            return
        }

        const parsedDate = record.date ? parseDateValue(normalizeQifDate(record.date), dateOrder) : null
        if (!parsedDate) {
            errors.push({ rowIndex, message: 'QIF record is missing a valid date' })
            return
        }

        const signed = record.amount != null ? parseImportAmount(record.amount) : null
        if (signed === null || signed === 0) {
            errors.push({ rowIndex, message: 'QIF record has an invalid or zero amount' })
            return
        }

        const title = (record.payee || record.memo || 'Imported transaction').trim().slice(0, 200)

        rows.push({
            rowIndex,
            date: toIsoDate(parsedDate),
            title: title || 'Imported transaction',
            description: record.memo?.trim() || undefined,
            amount: Math.abs(signed),
            type: inferTypeFromSignedAmount(signed),
        })
    })

    if (rows.length === 0 && errors.length === 0) {
        throw new Error('No valid transactions found in QIF file')
    }

    return { rows, errors }
}

export const assertImportRowLimit = (count: number): void => {
    if (count > IMPORT_MAX_ROWS) {
        throw new Error('Import file exceeds the 2,000 row limit')
    }
}

export const parseImportMapping = (value: unknown): ColumnMapping => {
    if (!value || typeof value !== 'object') {
        throw new Error('Column mapping is incomplete')
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

    if (DATE_FORMATS.includes(mapping.dateFormat as ImportDateFormat)) {
        result.dateFormat = mapping.dateFormat as ImportDateFormat
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

/**
 * Build a duplicate-detection fingerprint from date, transaction type, amount (minor units) and
 * description. `type` is part of the key (BUG-22) so an equal-magnitude refund (income) is never
 * mistaken for the original charge (expense).
 */
export const buildImportFingerprint = (
    date: string,
    type: 'income' | 'expense',
    amountMinor: number,
    title: string,
    description?: string
): string => {
    const normalizedDesc = normalizeImportDescription(title, description)
    return `${date}|${type}|${amountMinor}|${normalizedDesc}`
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
