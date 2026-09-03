// `'spndr_export'` is the pre-rename spelling of `'corvale_export'`, kept valid for one release
// as a rename-compat shim (V7.3c) — mirrors `shared/src/csvImport.ts`'s `ImportFormat`.
export type ImportFormat = 'generic' | 'chase' | 'corvale_export' | 'spndr_export' | 'ofx' | 'qif'

// Mirrors `shared/src/csvImport.ts`'s `ImportDateFormat` — token order for slash/dot/dash dates.
export type ImportDateFormat = 'auto' | 'YMD' | 'MDY' | 'DMY'

// Mirrors `shared/src/csvImport.ts`'s `IMPORT_DELIMITERS` — the field separators the CSV parser
// can sniff / be forced to (BUG-19).
export type ImportDelimiter = ',' | ';' | '\t' | '|'

export interface ImportRowError {
    rowIndex: number
    message: string
}

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
    /** OFX `FITID` — an exact re-import dedupe key (BUG-21). */
    externalId?: string
}

export interface ImportParseResponse {
    format: ImportFormat
    fileName: string
    totalRows: number
    sampleRows: string[][] | ParsedImportRow[]
    requiresMapping: boolean
    headers?: string[]
    rows?: string[][]
    parsedRows?: ParsedImportRow[]
    /** Skipped-block reasons from the OFX/QIF parser, carried into preview/commit (BUG-21/BUG-23). */
    parsedRowErrors?: ImportRowError[]
    /** OFX `<CURDEF>` — informational; the UI warns on a mismatch with the target account. */
    statementCurrency?: string
    /** The delimiter the CSV parser used (sniffed or forced). */
    delimiter?: ImportDelimiter
    suggestedMapping?: ColumnMapping
}

export interface ImportPreviewItem {
    rowIndex: number
    date: string
    title: string
    description?: string
    amount: number
    type: 'income' | 'expense'
    categoryId: string
    categoryName?: string
    tags?: string[]
    appliedRuleId?: string
    appliedRuleName?: string
    externalId?: string
    error?: string
    duplicateOf?: ImportDuplicateMatch
    duplicateAction?: ImportDuplicateAction
}

export type ImportDuplicateAction = 'skip' | 'import' | 'merge'

export interface ImportDuplicateMatch {
    transactionId: string
    title: string
    date: string
    amount: number
    categoryName?: string
}

export interface ImportPreviewSummary {
    total: number
    valid: number
    invalid: number
    duplicates: number
    incomeTotal: number
    expenseTotal: number
}

export interface ImportPreviewResponse {
    items: ImportPreviewItem[]
    summary: ImportPreviewSummary
}

export interface ImportCommitResponse {
    imported: number
    merged: number
    skipped: number
    transactionIds: string[]
    mergedTransactionIds: string[]
    summary: ImportPreviewSummary
}
