import type { LocalDb } from '@platform/db/LocalDb'
import { Repository } from '@platform/db/repositories/Repository'
import { generateLocalObjectId } from '@platform/db/generateLocalId'
import { recomputeLocalAccountBalance } from './accountBalances'
import { applyLocalCategorizationRules } from './categorizationRules'
import type { LocalAccount, LocalCategory, LocalTransaction } from './types'
import {
  IMPORT_MAX_ROWS,
  IMPORT_PREVIEW_SAMPLE_ROWS,
  isOfxContent,
  isQifContent,
  parseCsvContent,
  detectImportFormat,
  suggestColumnMapping,
  mapCsvRows,
  parseOfxContent,
  parseQifContent,
  assertImportRowLimit,
  sanitizeParsedImportRows,
  buildImportFingerprint,
  toImportIsoDate,
  type ColumnMapping,
  type ImportFormat,
  type ImportDateFormat,
  type ImportDelimiter,
  type ImportDuplicateAction,
  type ImportDuplicateMatch,
  type ParsedImportRow,
  type ImportRowError,
} from '@shared/csvImport'
import { parseAmountToMinorUnits, fromMinorUnits } from '@shared/money'

export { IMPORT_MAX_ROWS, IMPORT_PREVIEW_SAMPLE_ROWS }
export type {
  ColumnMapping,
  ImportFormat,
  ImportDateFormat,
  ImportDelimiter,
  ImportDuplicateAction,
  ImportDuplicateMatch,
  ParsedImportRow,
  ImportRowError,
}

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

/**
 * Local equivalent of `backend/controllers/importController.ts`'s response shape for
 * `POST /imports/parse` - built client-side (File API, no network) from the parsing/format
 * detection primitives in `shared/src/csvImport.ts`.
 */
export interface LocalImportParseResult {
  format: ImportFormat
  fileName: string
  totalRows: number
  sampleRows: string[][] | ParsedImportRow[]
  requiresMapping: boolean
  headers?: string[]
  rows?: string[][]
  parsedRows?: ParsedImportRow[]
  parsedRowErrors?: ImportRowError[]
  statementCurrency?: string
  delimiter?: ImportDelimiter
  suggestedMapping?: ColumnMapping
}

const extensionOf = (fileName: string): string => fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''

/** Reads and parses an uploaded bank statement entirely client-side - no network round trip. */
export const parseLocalImportFile = async (
  file: File,
  delimiter?: ImportDelimiter
): Promise<LocalImportParseResult> => {
  const content = await file.text()
  if (!content.trim()) {
    throw new Error('Import file is empty')
  }

  const looksOfx = isOfxContent(content)
  const looksQif = !looksOfx && isQifContent(content)

  if (looksOfx || looksQif) {
    const parsed = looksQif ? parseQifContent(content) : parseOfxContent(content)
    assertImportRowLimit(parsed.rows.length + parsed.errors.length)
    return {
      format: looksQif ? 'qif' : 'ofx',
      fileName: file.name,
      totalRows: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, IMPORT_PREVIEW_SAMPLE_ROWS),
      parsedRows: parsed.rows,
      parsedRowErrors: parsed.errors,
      statementCurrency: parsed.statementCurrency,
      requiresMapping: false,
    }
  }

  const extension = extensionOf(file.name)
  if (extension === '.ofx' || extension === '.qfx') {
    throw new Error('This file does not look like a valid OFX/QFX or QIF file')
  }

  const { headers, rows, delimiter: resolvedDelimiter } = parseCsvContent(content, delimiter)
  assertImportRowLimit(rows.length)

  const format = detectImportFormat(headers)
  const suggestedMapping = suggestColumnMapping(headers, format)

  return {
    format,
    fileName: file.name,
    headers,
    totalRows: rows.length,
    sampleRows: rows.slice(0, IMPORT_PREVIEW_SAMPLE_ROWS),
    rows,
    suggestedMapping,
    delimiter: resolvedDelimiter,
    requiresMapping: true,
  }
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

export interface ImportPreviewSummary {
  total: number
  valid: number
  invalid: number
  duplicates: number
  incomeTotal: number
  expenseTotal: number
}

export interface ImportPreviewResult {
  items: ImportPreviewItem[]
  summary: ImportPreviewSummary
}

export interface BuildLocalImportInput {
  accountId: string
  defaultCategoryId: string
  headers?: string[]
  rows?: string[][]
  mapping?: ColumnMapping
  parsedRows?: ParsedImportRow[]
  /** OFX/QIF skipped-block reasons from parse time, surfaced in the preview (BUG-21/BUG-23). */
  parsedRowErrors?: ImportRowError[]
}

/** Resolves the row set from either an already-parsed OFX/QIF payload or a headers+rows+mapping CSV payload. */
const resolveImportRows = (
  input: BuildLocalImportInput
): { importRows: ParsedImportRow[]; rowErrors: ImportRowError[] } => {
  if (Array.isArray(input.parsedRows) && input.parsedRows.length > 0) {
    // Mirrors the backend SEC-52 guard: validate the parsed-row set before it drives a commit.
    return {
      importRows: sanitizeParsedImportRows(input.parsedRows),
      rowErrors: input.parsedRowErrors ?? [],
    }
  }
  if (!Array.isArray(input.headers) || !Array.isArray(input.rows)) {
    throw new Error('Column mapping is incomplete')
  }
  const mapped = mapCsvRows(input.headers, input.rows, input.mapping ?? {})
  return { importRows: mapped.rows, rowErrors: mapped.errors }
}

interface LocalDuplicateMaps {
  /** `buildImportFingerprint` key → match (fuzzy date/type/amount/description). */
  fingerprintMap: Map<string, ImportDuplicateMatch>
  /** `externalId` (OFX FITID) → match. Exact; checked first (BUG-21). */
  externalIdMap: Map<string, ImportDuplicateMatch>
}

/** Mirrors `backend/controllers/importController.ts`'s `loadExistingDuplicateMap`, reading local transactions instead of Mongo. */
const buildLocalDuplicateMap = async (
  db: LocalDb,
  accountId: string,
  rows: ParsedImportRow[]
): Promise<LocalDuplicateMaps> => {
  const fingerprintMap = new Map<string, ImportDuplicateMatch>()
  const externalIdMap = new Map<string, ImportDuplicateMatch>()
  if (rows.length === 0) {
    return { fingerprintMap, externalIdMap }
  }

  const [transactions, categories] = await Promise.all([transactionsRepo.list(db), categoriesRepo.list(db)])
  const categoryNameById = new Map(categories.map((category) => [category._id, category.name]))

  const candidates = transactions.filter(
    (tx) => tx.accountId === accountId && tx.status === 'posted' && tx.splitTransactionId === null
  )

  for (const transaction of candidates) {
    const isoDate = toImportIsoDate(new Date(transaction.date))
    const match: ImportDuplicateMatch = {
      transactionId: transaction._id,
      title: transaction.title,
      date: isoDate,
      amount: fromMinorUnits(transaction.amount),
      categoryName: categoryNameById.get(transaction.categoryId),
    }

    if (transaction.externalId && !externalIdMap.has(transaction.externalId)) {
      externalIdMap.set(transaction.externalId, match)
    }

    const fingerprint = buildImportFingerprint(
      isoDate,
      transaction.type === 'income' ? 'income' : 'expense',
      transaction.amount,
      transaction.title,
      transaction.description
    )
    if (!fingerprintMap.has(fingerprint)) {
      fingerprintMap.set(fingerprint, match)
    }
  }

  return { fingerprintMap, externalIdMap }
}

/** Mirrors `backend/utils/categorizationRuleUtils.ts`'s `mergeTags`: dedupe a transaction's own tags with a matched rule's tags. */
const mergeTags = (existing: string[] | undefined, ruleTags: string[] | undefined): string[] | undefined => {
  if (!ruleTags || ruleTags.length === 0) {
    return existing
  }
  const merged = [...new Set([...(existing ?? []), ...ruleTags])]
  return merged.length > 0 ? merged : undefined
}

/** Mirrors `backend/controllers/importController.ts`'s `buildPreviewItems`, applying local categorization rules per row. */
const buildLocalPreviewItems = async (
  db: LocalDb,
  accountId: string,
  defaultCategoryId: string,
  rows: ParsedImportRow[]
): Promise<ImportPreviewItem[]> => {
  const categories = await categoriesRepo.list(db)
  const categoryById = new Map(categories.map((category) => [category._id, category]))

  return Promise.all(
    rows.map(async (row) => {
      try {
        const amountMinor = parseAmountToMinorUnits(row.amount)
        const ruleResult = await applyLocalCategorizationRules(db, {
          title: row.title,
          description: row.description,
          amount: amountMinor,
          accountId,
          type: row.type,
        })

        const categoryId = ruleResult?.categoryId ?? defaultCategoryId
        const category = categoryById.get(categoryId)
        if (!category) {
          throw new Error('Category not found')
        }
        if (category.isArchived) {
          throw new Error('Category is archived')
        }

        return {
          rowIndex: row.rowIndex,
          date: row.date,
          title: row.title,
          description: row.description,
          amount: row.amount,
          type: row.type,
          externalId: row.externalId,
          categoryId,
          categoryName: category.name,
          tags: ruleResult ? mergeTags(undefined, ruleResult.tags) : undefined,
          appliedRuleId: ruleResult?.ruleId,
          appliedRuleName: ruleResult?.ruleName,
        }
      } catch (error) {
        return {
          rowIndex: row.rowIndex,
          date: row.date,
          title: row.title,
          description: row.description,
          amount: row.amount,
          type: row.type,
          externalId: row.externalId,
          categoryId: defaultCategoryId,
          error: error instanceof Error ? error.message : 'Failed to map row',
        }
      }
    })
  )
}

const attachLocalDuplicateInfo = async (
  db: LocalDb,
  accountId: string,
  items: ImportPreviewItem[],
  importRows: ParsedImportRow[]
): Promise<ImportPreviewItem[]> => {
  const validRows = importRows.filter((row) => items.some((item) => item.rowIndex === row.rowIndex && !item.error))
  const { fingerprintMap, externalIdMap } = await buildLocalDuplicateMap(db, accountId, validRows)

  return items.map((item) => {
    if (item.error) {
      return item
    }

    const row = importRows.find((candidate) => candidate.rowIndex === item.rowIndex)
    if (!row) {
      return item
    }

    const amountMinor = parseAmountToMinorUnits(row.amount)
    const duplicateOf =
      (row.externalId ? externalIdMap.get(row.externalId) : undefined) ??
      fingerprintMap.get(buildImportFingerprint(row.date, row.type, amountMinor, row.title, row.description))

    if (!duplicateOf) {
      return item
    }

    return { ...item, duplicateOf, duplicateAction: 'skip' as const }
  })
}

const summarizeLocalPreview = (items: ImportPreviewItem[]): ImportPreviewSummary => {
  const validItems = items.filter((item) => !item.error)
  const duplicateItems = validItems.filter((item) => item.duplicateOf)
  const incomeTotal = validItems.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)
  const expenseTotal = validItems
    .filter((item) => item.type === 'expense')
    .reduce((sum, item) => sum + item.amount, 0)

  return {
    total: items.length,
    valid: validItems.length,
    invalid: items.length - validItems.length,
    duplicates: duplicateItems.length,
    incomeTotal,
    expenseTotal,
  }
}

/** Local counterpart to `POST /imports/preview`: detects duplicates against local transactions instead of a server round-trip. */
export const previewLocalImport = async (db: LocalDb, input: BuildLocalImportInput): Promise<ImportPreviewResult> => {
  const account = await accountsRepo.findById(db, input.accountId)
  if (!account) {
    throw new Error('Account not found')
  }
  const category = await categoriesRepo.findById(db, input.defaultCategoryId)
  if (!category) {
    throw new Error('Category not found')
  }

  const { importRows, rowErrors } = resolveImportRows(input)
  assertImportRowLimit(importRows.length + rowErrors.length)

  const previewItems = await buildLocalPreviewItems(db, input.accountId, input.defaultCategoryId, importRows)
  const itemsWithDuplicates = await attachLocalDuplicateInfo(db, input.accountId, previewItems, importRows)

  const errorItems: ImportPreviewItem[] = rowErrors.map((error) => ({
    rowIndex: error.rowIndex,
    date: '',
    title: '',
    amount: 0,
    type: 'expense',
    categoryId: input.defaultCategoryId,
    error: error.message,
  }))

  const items = [...itemsWithDuplicates, ...errorItems].sort((a, b) => a.rowIndex - b.rowIndex)

  return { items, summary: summarizeLocalPreview(items) }
}

export interface CommitLocalImportInput extends BuildLocalImportInput {
  userId: string
  workspaceId?: string | null
  rowDecisions?: Record<number, ImportDuplicateAction>
}

export interface LocalImportCommitResult {
  imported: number
  merged: number
  skipped: number
  transactionIds: string[]
  mergedTransactionIds: string[]
  summary: ImportPreviewSummary
}

const resolveDuplicateAction = (
  item: ImportPreviewItem,
  rowDecisions: Map<number, ImportDuplicateAction>
): ImportDuplicateAction => {
  if (!item.duplicateOf) {
    return 'import'
  }
  return rowDecisions.get(item.rowIndex) ?? item.duplicateAction ?? 'skip'
}

const parseRowDecisions = (value?: Record<number, ImportDuplicateAction>): Map<number, ImportDuplicateAction> => {
  const decisions = new Map<number, ImportDuplicateAction>()
  if (!value) {
    return decisions
  }
  for (const [rowIndex, action] of Object.entries(value)) {
    decisions.set(Number(rowIndex), action)
  }
  return decisions
}

const persistAccountBalance = async (db: LocalDb, accountId: string): Promise<void> => {
  const account = await accountsRepo.findById(db, accountId)
  if (!account) {
    throw new Error(`Account ${accountId} not found locally`)
  }
  const balance = await recomputeLocalAccountBalance(db, accountId)
  const updated: LocalAccount = { ...account, currentBalance: balance }
  await db.exec(`UPDATE accounts SET data = ?, currentBalance = ?, _localUpdatedAt = ? WHERE _id = ?`, [
    JSON.stringify(updated),
    balance,
    new Date().toISOString(),
    accountId,
  ])
}

/**
 * Local counterpart to `POST /imports/commit`. Accepted rows are written through
 * `Repository.create` (mirroring every other migrated page) so they queue to the outbox
 * automatically, including the existing "workspace-scoped writes require connectivity" rejection
 * in `sync/outbox.ts`'s `Outbox.enqueue` when `workspaceId` is set and the device is offline -
 * this function does not special-case that, the rejection just propagates to the caller.
 */
export const commitLocalImport = async (db: LocalDb, input: CommitLocalImportInput): Promise<LocalImportCommitResult> => {
  const account = await accountsRepo.findById(db, input.accountId)
  if (!account) {
    throw new Error('Account not found')
  }
  const defaultCategory = await categoriesRepo.findById(db, input.defaultCategoryId)
  if (!defaultCategory) {
    throw new Error('Category not found')
  }

  const rowDecisions = parseRowDecisions(input.rowDecisions)
  const { importRows, rowErrors } = resolveImportRows(input)
  assertImportRowLimit(importRows.length + rowErrors.length)

  const previewItems = await buildLocalPreviewItems(db, input.accountId, input.defaultCategoryId, importRows)
  const itemsWithDuplicates = await attachLocalDuplicateInfo(db, input.accountId, previewItems, importRows)

  const validItems = itemsWithDuplicates.filter((item) => !item.error)
  if (validItems.length === 0) {
    throw new Error('No valid rows to import')
  }

  const createdIds: string[] = []
  const mergedIds: string[] = []
  let skipped = previewItems.length - validItems.length + rowErrors.length

  await db.transaction(async (tx) => {
    let baseNow = Date.now()

    for (const item of validItems) {
      const action = resolveDuplicateAction(item, rowDecisions)

      if (action === 'skip') {
        if (item.duplicateOf) {
          skipped += 1
        }
        continue
      }

      if (action === 'merge') {
        if (!item.duplicateOf) {
          throw new Error('Cannot merge a row that has no matching transaction')
        }
        const existing = await transactionsRepo.findById(tx, item.duplicateOf.transactionId)
        if (!existing) {
          throw new Error('Transaction not found')
        }
        const updated: LocalTransaction = {
          ...existing,
          categoryId: item.categoryId,
          tags: item.tags && item.tags.length > 0 ? mergeTags(existing.tags, item.tags) : existing.tags,
          description: !existing.description && item.description ? item.description : existing.description,
          updatedAt: new Date().toISOString(),
        }
        await transactionsRepo.update(tx, updated, existing.updatedAt)
        mergedIds.push(item.duplicateOf.transactionId)
        continue
      }

      const amountMinor = parseAmountToMinorUnits(item.amount)
      baseNow += 1
      const nowIso = new Date(baseNow).toISOString()
      const doc: LocalTransaction = {
        _id: generateLocalObjectId(),
        updatedAt: nowIso,
        createdAt: nowIso,
        userId: input.userId,
        workspaceId: input.workspaceId ?? null,
        accountId: input.accountId,
        categoryId: item.categoryId,
        type: item.type,
        status: 'posted',
        amount: amountMinor,
        title: item.title,
        description: item.description,
        date: new Date(`${item.date}T12:00:00.000Z`).toISOString(),
        clearedStatus: 'pending',
        tags: item.tags,
        externalId: item.externalId,
        splitTransactionId: null,
      }
      await transactionsRepo.create(tx, doc)
      createdIds.push(doc._id)
    }

    if (createdIds.length > 0) {
      await persistAccountBalance(tx, input.accountId)
    }
  })

  return {
    imported: createdIds.length,
    merged: mergedIds.length,
    skipped,
    transactionIds: createdIds,
    mergedTransactionIds: mergedIds,
    summary: summarizeLocalPreview([
      ...itemsWithDuplicates,
      ...rowErrors.map((error) => ({
        rowIndex: error.rowIndex,
        date: '',
        title: '',
        amount: 0,
        type: 'expense' as const,
        categoryId: input.defaultCategoryId,
        error: error.message,
      })),
    ]),
  }
}
