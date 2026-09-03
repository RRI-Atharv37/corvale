import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalDb } from '@platform/db/LocalDb'
import type { LocalAccount, LocalCategorizationRule, LocalCategory, LocalTransaction } from '../types'
import {
  IMPORT_MAX_ROWS,
  isOfxContent,
  parseCsvContent,
  detectImportFormat,
  suggestColumnMapping,
  mapCsvRows,
  parseOfxContent,
  parseQifContent,
  assertImportRowLimit,
} from '@shared/csvImport'
import { parseLocalImportFile, previewLocalImport, commitLocalImport } from '../importTransactions'

/**
 * Sprint 13.10 acceptance criteria: local (client-side) CSV/OFX parsing, column mapping,
 * preview and duplicate detection must match the server's (`backend/tests/import.test.ts` and
 * `backend/tests/importDuplicates.test.ts`). Every fixture and expected value below is copied
 * verbatim from those two suites so this is a genuine cross-check against the pre-extraction
 * behavior, not a tautological "call the same function twice" test.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const transactionsRepo = new Repository<LocalTransaction>('transactions')
const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

const seedAccountAndCategory = async (
  db: LocalDb,
  openingBalance = 1000
): Promise<{ accountId: string; categoryId: string }> => {
  const accountId = nextId()
  const categoryId = nextId()
  await accountsRepo.upsertFromServer(db, [
    {
      _id: accountId,
      updatedAt: nowIso(),
      userId: 'u1',
      name: 'Checking',
      type: 'checking',
      currency: 'USD',
      currentBalance: openingBalance,
      isArchived: false,
    },
  ])
  await categoriesRepo.upsertFromServer(db, [
    { _id: categoryId, updatedAt: nowIso(), userId: 'u1', masterCategoryId: null, name: 'Food', isArchived: false },
  ])
  return { accountId, categoryId }
}

const GENERIC_CSV = ['Date,Description,Amount', '2026-01-05,Grocery Store,-45.50', '2026-01-06,Paycheck,2000'].join(
  '\n'
)

const CHASE_CSV = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '01/05/2026,01/06/2026,Grocery Store,Groceries,Sale,-45.50,',
  '01/06/2026,01/07/2026,Employer Payroll,,Payment,2000.00,',
].join('\n')

const CORVALE_EXPORT_CSV = [
  'Type,Title,Amount,Currency,Category,Date,Description,Source,Payment Method,Tags,Status',
  'expense,Grocery Store,45.50,USD,Food,2026-01-05,Weekly shop,manual,card,groceries,posted',
].join('\n')

describe('shared/csvImport parity: parse & format detection', () => {
  it('detects a generic CSV format and suggests a column mapping (matches server)', () => {
    const { headers, rows } = parseCsvContent(GENERIC_CSV)
    const format = detectImportFormat(headers)
    const suggestedMapping = suggestColumnMapping(headers, format)

    expect(format).toBe('generic')
    expect(rows).toHaveLength(2)
    expect(suggestedMapping.date).toBe('Date')
    expect(suggestedMapping.amount).toBe('Amount')
    expect(suggestedMapping.description).toBe('Description')
  })

  it('detects a Chase-style CSV format (matches server)', () => {
    const { headers } = parseCsvContent(CHASE_CSV)
    const format = detectImportFormat(headers)
    const suggestedMapping = suggestColumnMapping(headers, format)

    expect(format).toBe('chase')
    expect(suggestedMapping.date).toBe('Transaction Date')
    expect(suggestedMapping.description).toBe('Description')
    expect(suggestedMapping.amount).toBe('Amount')
  })

  it('detects a corvale_export CSV format matching the export column order (matches server)', () => {
    const { headers } = parseCsvContent(CORVALE_EXPORT_CSV)
    expect(detectImportFormat(headers)).toBe('corvale_export')
  })

  /**
   * V7.3c rename-compat shim: the internal format tag returned by `detectImportFormat` renames
   * from `'spndr_export'` to `'corvale_export'`, but `'spndr_export'` must stay a valid
   * `ImportFormat` value that `suggestColumnMapping` still resolves identically - this is what
   * removes the backend/frontend atomic-deploy constraint (an older build anywhere in the
   * pipeline that still produces/expects `'spndr_export'` keeps working) and preserves every
   * export a tester already made before the rename shipped (ROADMAP's V7 compat matrix).
   */
  it('accepts the legacy spndr_export format tag as equivalent to corvale_export (accept legacy on read)', () => {
    const { headers } = parseCsvContent(CORVALE_EXPORT_CSV)

    const legacyMapping = suggestColumnMapping(headers, 'spndr_export')
    const currentMapping = suggestColumnMapping(headers, 'corvale_export')

    expect(legacyMapping).toEqual(currentMapping)
    expect(legacyMapping.date).toBe('Date')
    expect(legacyMapping.description).toBe('Title')
    expect(legacyMapping.amount).toBe('Amount')
  })

  it('parses OFX content directly without requiring a column mapping (matches server)', () => {
    const ofx = [
      'OFXHEADER:100',
      '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
      '<STMTTRN><TRNTYPE>DEBIT<TRNAMT>-45.50<DTPOSTED>20260105120000<NAME>Grocery Store</STMTTRN>',
      '<STMTTRN><TRNTYPE>CREDIT<TRNAMT>2000.00<DTPOSTED>20260106120000<NAME>Employer Payroll</STMTTRN>',
      '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
    ].join('\n')

    expect(isOfxContent(ofx)).toBe(true)
    const { rows, errors } = parseOfxContent(ofx)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(2)
    expect(rows[0].type).toBe('expense')
    expect(rows[1].type).toBe('income')
  })

  it('extracts FITID / TRNTYPE / CURDEF and reports skipped blocks (BUG-21)', () => {
    const ofx = [
      'OFXHEADER:100',
      '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKTRANLIST>',
      '<STMTTRN><TRNTYPE>CREDIT<TRNAMT>10.00<DTPOSTED>20260105120000<NAME>Refund<FITID>F-1</STMTTRN>',
      '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260106120000<NAME>Memo hold<FITID>F-2</STMTTRN>',
      '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
    ].join('\n')
    const result = parseOfxContent(ofx)
    expect(result.statementCurrency).toBe('EUR')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ type: 'income', externalId: 'F-1' })
    expect(result.errors).toHaveLength(1)
  })

  it('parses a QIF file and detects a QIF renamed .qfx (BUG-23)', async () => {
    const qif = ['!Type:Bank', 'D01/05/2026', 'T-45.50', 'PGrocery Store', '^'].join('\n')
    const { rows, errors } = parseQifContent(qif)
    expect(errors).toHaveLength(0)
    expect(rows[0]).toMatchObject({ date: '2026-01-05', title: 'Grocery Store', amount: 45.5, type: 'expense' })

    const asQfx = new File([qif], 'export.qfx', { type: 'application/octet-stream' })
    const parsed = await parseLocalImportFile(asQfx)
    expect(parsed.format).toBe('qif')
    expect(parsed.parsedRows).toHaveLength(1)
  })

  it('rejects an empty file (matches server)', () => {
    expect(() => parseCsvContent('   ')).toThrow(/empty/i)
  })

  it('rejects a CSV with a blank header row (matches server)', () => {
    expect(() => parseCsvContent(',,,\n1,2,3,4')).toThrow(/header/i)
  })

  it('rejects a CSV exceeding the 2,000 row limit (matches server)', () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `2026-01-01,Row ${i},-1.00`)
    const content = ['Date,Description,Amount', ...rows].join('\n')
    const { rows: parsedRows } = parseCsvContent(content)
    expect(() => assertImportRowLimit(parsedRows.length)).toThrow(/2,000 row limit/i)
    expect(parsedRows.length).toBeGreaterThan(IMPORT_MAX_ROWS)
  })
})

describe('shared/csvImport parity: column mapping & row mapping', () => {
  it('maps debit/credit columns into expense/income rows (matches server)', () => {
    const { rows: parsed } = mapCsvRows(
      ['Date', 'Description', 'Debit', 'Credit'],
      [
        ['2026-01-05', 'Grocery Store', '45.50', ''],
        ['2026-01-06', 'Paycheck', '', '2000.00'],
      ],
      { date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit' }
    )

    expect(parsed).toHaveLength(2)
    expect(parsed[0].type).toBe('expense')
    expect(parsed[0].amount).toBe(45.5)
    expect(parsed[1].type).toBe('income')
    expect(parsed[1].amount).toBe(2000)
  })

  it('infers income/expense from a signed amount column (matches server)', () => {
    const { rows: parsed } = mapCsvRows(
      ['Date', 'Description', 'Amount'],
      [['2026-01-05', 'Grocery Store', '-45.50']],
      { date: 'Date', description: 'Description', amount: 'Amount' }
    )
    expect(parsed[0].type).toBe('expense')
    expect(parsed[0].amount).toBe(45.5)
  })

  it('rejects a mapping missing the required date column (matches server)', () => {
    expect(() =>
      mapCsvRows(['Description', 'Amount'], [['Grocery Store', '-45.50']], {
        description: 'Description',
        amount: 'Amount',
      })
    ).toThrow(/date column/i)
  })

  it('surfaces row-level errors for invalid dates and both-set debit/credit without failing the whole batch (matches server)', () => {
    const { rows: parsed, errors } = mapCsvRows(
      ['Date', 'Description', 'Debit', 'Credit'],
      [
        ['not-a-date', 'Bad Row', '10.00', ''],
        ['2026-01-05', 'Both Set', '10.00', '5.00'],
        ['2026-01-06', 'Good Row', '12.00', ''],
      ],
      { date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit' }
    )

    expect(parsed).toHaveLength(1)
    expect(errors).toHaveLength(2)
  })
})

describe('domain/importTransactions: local preview & commit parity', () => {
  it('applies matching categorization rules to preview rows (matches server)', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)
    await rulesRepo.upsertFromServer(db, [
      {
        _id: nextId(),
        updatedAt: nowIso(),
        userId: 'u1',
        name: 'Grocery rule',
        matchType: 'description_contains',
        matchValue: 'grocery',
        categoryId,
        tags: ['groceries'],
        priority: 0,
        isActive: true,
      },
    ])

    const preview = await previewLocalImport(db, {
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-01-05', 'Grocery Store run', '-45.50']],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    expect(preview.items[0].appliedRuleName).toBe('Grocery rule')
    expect(preview.items[0].tags).toEqual(['groceries'])
  })

  it('creates transactions and updates the account balance on commit (matches server: 1000 - 45.50 + 2000)', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db, 1000)

    const result = await commitLocalImport(db, {
      userId: 'u1',
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [
        ['2026-01-05', 'Grocery Store', '-45.50'],
        ['2026-01-06', 'Paycheck', '2000'],
      ],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    expect(result.imported).toBe(2)
    expect(result.transactionIds).toHaveLength(2)

    const account = await accountsRepo.findById(db, accountId)
    expect(account?.currentBalance).toBe(1000 - 45.5 + 2000)
  })

  it('rejects commit when no rows are valid (matches server)', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)

    await expect(
      commitLocalImport(db, {
        userId: 'u1',
        accountId,
        defaultCategoryId: categoryId,
        headers: ['Date', 'Description', 'Amount'],
        rows: [['bad-date', 'Bad Row', '10.00']],
        mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      })
    ).rejects.toThrow(/no valid rows/i)
  })
})

describe('domain/importTransactions: duplicate detection parity (backend/tests/importDuplicates.test.ts)', () => {
  const seedExisting = async (
    db: LocalDb,
    accountId: string,
    categoryId: string,
    title: string,
    amount: number,
    isoDate: string
  ): Promise<string> => {
    const result = await commitLocalImport(db, {
      userId: 'u1',
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [[isoDate, title, String(-amount)]],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })
    return result.transactionIds[0]
  }

  it('flags an import row as a duplicate of an existing transaction with matching date/amount/description', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)
    const existingId = await seedExisting(db, accountId, categoryId, 'Coffee Shop', 5.25, '2026-01-10')

    const preview = await previewLocalImport(db, {
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-01-10', 'Coffee Shop', '-5.25']],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    expect(preview.items[0].duplicateOf).toBeDefined()
    expect(preview.items[0].duplicateOf?.transactionId).toBe(existingId)
    expect(preview.items[0].duplicateAction).toBe('skip')
    expect(preview.summary.duplicates).toBe(1)
  })

  it('does not flag an equal-magnitude refund (income) as a duplicate of the original charge (expense) — BUG-22', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)
    await seedExisting(db, accountId, categoryId, 'ACME', 50, '2026-03-01')

    const preview = await previewLocalImport(db, {
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-03-01', 'ACME', '50.00']],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    expect(preview.items[0].type).toBe('income')
    expect(preview.items[0].duplicateOf).toBeUndefined()
    expect(preview.summary.duplicates).toBe(0)
  })

  it('does not flag two same-day charges with the same amount but different descriptions as duplicates of each other', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)
    await seedExisting(db, accountId, categoryId, 'Coffee Shop', 5.0, '2026-01-10')

    const preview = await previewLocalImport(db, {
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-01-10', 'Sandwich Shop', '-5.00']],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    expect(preview.items[0].duplicateOf).toBeUndefined()
    expect(preview.summary.duplicates).toBe(0)
  })

  it('distinguishes multiple same-day charges to the same merchant by amount', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)
    await seedExisting(db, accountId, categoryId, 'Coffee Shop', 5.0, '2026-01-10')

    const preview = await previewLocalImport(db, {
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [
        ['2026-01-10', 'Coffee Shop', '-5.00'],
        ['2026-01-10', 'Coffee Shop', '-7.50'],
      ],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    expect(preview.items[0].duplicateOf).toBeDefined()
    expect(preview.items[1].duplicateOf).toBeUndefined()
  })

  it('skips duplicate rows on commit by default', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)
    await seedExisting(db, accountId, categoryId, 'Coffee Shop', 5.25, '2026-01-10')

    const result = await commitLocalImport(db, {
      userId: 'u1',
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [
        ['2026-01-10', 'Coffee Shop', '-5.25'],
        ['2026-01-11', 'Bookstore', '-12.00'],
      ],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)

    const all = await transactionsRepo.list(db)
    const total = all.filter((tx) => tx.accountId === accountId && tx.splitTransactionId === null)
    expect(total).toHaveLength(2)
  })

  it('imports a duplicate row as a new transaction when the row decision is "import"', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)
    await seedExisting(db, accountId, categoryId, 'Coffee Shop', 5.25, '2026-01-10')

    const result = await commitLocalImport(db, {
      userId: 'u1',
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-01-10', 'Coffee Shop', '-5.25']],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      rowDecisions: { 1: 'import' },
    })

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)

    const all = await transactionsRepo.list(db)
    const total = all.filter((tx) => tx.accountId === accountId && tx.splitTransactionId === null)
    expect(total).toHaveLength(2)
  })

  it('merges a duplicate row into the existing transaction when the row decision is "merge"', async () => {
    const db = await freshDb()
    const { accountId, categoryId } = await seedAccountAndCategory(db)
    const existingId = await seedExisting(db, accountId, categoryId, 'Coffee Shop', 5.25, '2026-01-10')

    await rulesRepo.upsertFromServer(db, [
      {
        _id: nextId(),
        updatedAt: nowIso(),
        userId: 'u1',
        name: 'Coffee rule',
        matchType: 'description_contains',
        matchValue: 'coffee',
        categoryId,
        tags: ['coffee'],
        priority: 0,
        isActive: true,
      },
    ])

    const result = await commitLocalImport(db, {
      userId: 'u1',
      accountId,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-01-10', 'Coffee Shop', '-5.25']],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
      rowDecisions: { 1: 'merge' },
    })

    expect(result.imported).toBe(0)
    expect(result.merged).toBe(1)
    expect(result.mergedTransactionIds).toEqual([existingId])

    const all = await transactionsRepo.list(db)
    const total = all.filter((tx) => tx.accountId === accountId && tx.splitTransactionId === null)
    expect(total).toHaveLength(1)

    const merged = await transactionsRepo.findById(db, existingId)
    expect(merged?.tags).toContain('coffee')
  })

  it('only compares duplicates within the same account', async () => {
    const db = await freshDb()
    const { accountId: accountA, categoryId } = await seedAccountAndCategory(db)
    const accountB = nextId()
    await accountsRepo.upsertFromServer(db, [
      {
        _id: accountB,
        updatedAt: nowIso(),
        userId: 'u1',
        name: 'Checking B',
        type: 'checking',
        currency: 'USD',
        currentBalance: 1000,
        isArchived: false,
      },
    ])
    await seedExisting(db, accountA, categoryId, 'Coffee Shop', 5.25, '2026-01-10')

    const preview = await previewLocalImport(db, {
      accountId: accountB,
      defaultCategoryId: categoryId,
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-01-10', 'Coffee Shop', '-5.25']],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    expect(preview.items[0].duplicateOf).toBeUndefined()
  })
})

describe('domain/importTransactions: parseLocalImportFile (File API, no network)', () => {
  it('parses a File the same way the server parses an uploaded buffer', async () => {
    const file = new File([GENERIC_CSV], 'transactions.csv', { type: 'text/csv' })
    const result = await parseLocalImportFile(file)

    expect(result.format).toBe('generic')
    expect(result.requiresMapping).toBe(true)
    expect(result.totalRows).toBe(2)
    expect(result.suggestedMapping?.date).toBe('Date')
    expect(result.suggestedMapping?.amount).toBe('Amount')
  })

  it('parses an OFX File without requiring a column mapping', async () => {
    const ofx = [
      'OFXHEADER:100',
      '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
      '<STMTTRN><TRNTYPE>DEBIT<TRNAMT>-45.50<DTPOSTED>20260105120000<NAME>Grocery Store</STMTTRN>',
      '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
    ].join('\n')
    const file = new File([ofx], 'transactions.ofx', { type: 'text/plain' })
    const result = await parseLocalImportFile(file)

    expect(result.format).toBe('ofx')
    expect(result.requiresMapping).toBe(false)
    expect(result.parsedRows).toHaveLength(1)
  })
})
