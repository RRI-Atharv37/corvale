import { CustomError } from './customError'
import {
    IMPORT_MAX_ROWS,
    IMPORT_PREVIEW_SAMPLE_ROWS,
    isOfxContent,
    parseCsvLine,
    parseCsvContent as sharedParseCsvContent,
    detectImportFormat,
    suggestColumnMapping,
    mapCsvRows as sharedMapCsvRows,
    parseOfxContent as sharedParseOfxContent,
    assertImportRowLimit as sharedAssertImportRowLimit,
    parseImportMapping as sharedParseImportMapping,
    normalizeImportDescription,
    buildImportFingerprint,
    toImportIsoDate,
    parseImportRowDecisions,
} from '../../shared/src/csvImport'
import type {
    ImportFormat,
    ColumnMappingField,
    ColumnMapping,
    ParsedImportRow,
    ImportRowError,
    ImportDuplicateAction,
    ImportDuplicateMatch,
} from '../../shared/src/csvImport'

export { IMPORT_MAX_ROWS, IMPORT_PREVIEW_SAMPLE_ROWS }
export type {
    ImportFormat,
    ColumnMappingField,
    ColumnMapping,
    ParsedImportRow,
    ImportRowError,
    ImportDuplicateAction,
    ImportDuplicateMatch,
}
export { isOfxContent, parseCsvLine, detectImportFormat, suggestColumnMapping }
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

export const parseCsvContent = (content: string): { headers: string[]; rows: string[][] } =>
    withImportError(() => sharedParseCsvContent(content))

export const mapCsvRows = (
    headers: string[],
    rows: string[][],
    mapping: ColumnMapping
): { rows: ParsedImportRow[]; errors: ImportRowError[] } =>
    withImportError(() => sharedMapCsvRows(headers, rows, mapping))

export const parseOfxContent = (content: string): ParsedImportRow[] =>
    withImportError(() => sharedParseOfxContent(content))

export const assertImportRowLimit = (count: number): void =>
    withImportError(() => sharedAssertImportRowLimit(count))

export const parseImportMapping = (value: unknown): ColumnMapping =>
    withImportError(() => sharedParseImportMapping(value))
