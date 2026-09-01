import { CustomError } from './customError'
import {
    IMPORT_MAX_ROWS,
    IMPORT_PREVIEW_SAMPLE_ROWS,
    IMPORT_DELIMITERS,
    isOfxContent,
    isQifContent,
    parseCsvLine,
    sniffDelimiter,
    parseCsvContent as sharedParseCsvContent,
    detectImportFormat,
    suggestColumnMapping,
    mapCsvRows as sharedMapCsvRows,
    parseOfxContent as sharedParseOfxContent,
    parseQifContent as sharedParseQifContent,
    assertImportRowLimit as sharedAssertImportRowLimit,
    parseImportMapping as sharedParseImportMapping,
    sanitizeParsedImportRows as sharedSanitizeParsedImportRows,
    normalizeImportDescription,
    buildImportFingerprint,
    toImportIsoDate,
    parseImportRowDecisions,
} from '@shared/csvImport'
import type {
    ImportFormat,
    ImportDateFormat,
    ImportDelimiter,
    ColumnMappingField,
    ColumnMapping,
    ParsedImportRow,
    ParsedCsvContent,
    ParsedStatementResult,
    ImportRowError,
    ImportDuplicateAction,
    ImportDuplicateMatch,
} from '@shared/csvImport'

export { IMPORT_MAX_ROWS, IMPORT_PREVIEW_SAMPLE_ROWS, IMPORT_DELIMITERS }
export type {
    ImportFormat,
    ImportDateFormat,
    ImportDelimiter,
    ColumnMappingField,
    ColumnMapping,
    ParsedImportRow,
    ParsedCsvContent,
    ParsedStatementResult,
    ImportRowError,
    ImportDuplicateAction,
    ImportDuplicateMatch,
}
export { isOfxContent, isQifContent, parseCsvLine, sniffDelimiter, detectImportFormat, suggestColumnMapping }
export { normalizeImportDescription, buildImportFingerprint, toImportIsoDate, parseImportRowDecisions }

/**
 * Translates the shared parser/mapper's plain `Error` into a `CustomError(400)` to preserve
 * existing API behavior — every import-related error in the pre-extraction module was a 400.
 */
const withImportError = <T>(fn: () => T): T => {
    try {
        return fn()
    } catch (err) {
        if (err instanceof CustomError) {
            throw err
        }
        if (err instanceof Error) {
            throw new CustomError(err.message, 400)
        }
        throw err
    }
}

export const parseCsvContent = (content: string, delimiter?: ImportDelimiter): ParsedCsvContent =>
    withImportError(() => sharedParseCsvContent(content, delimiter))

export const mapCsvRows = (
    headers: string[],
    rows: string[][],
    mapping: ColumnMapping
): { rows: ParsedImportRow[]; errors: ImportRowError[] } =>
    withImportError(() => sharedMapCsvRows(headers, rows, mapping))

export const parseOfxContent = (content: string): ParsedStatementResult =>
    withImportError(() => sharedParseOfxContent(content))

export const parseQifContent = (content: string): ParsedStatementResult =>
    withImportError(() => sharedParseQifContent(content))

export const assertImportRowLimit = (count: number): void =>
    withImportError(() => sharedAssertImportRowLimit(count))

export const parseImportMapping = (value: unknown): ColumnMapping =>
    withImportError(() => sharedParseImportMapping(value))

export const sanitizeParsedImportRows = (value: unknown): ParsedImportRow[] =>
    withImportError(() => sharedSanitizeParsedImportRows(value))
