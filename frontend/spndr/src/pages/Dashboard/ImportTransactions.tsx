import React, { useCallback, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { IoArrowBack, IoCheckmarkCircle, IoCloudUploadOutline } from 'react-icons/io5'
import { Link, useNavigate } from 'react-router-dom'

import PageHeader from '../../components/ui/PageHeader'
import AccountPicker from '../../components/accounts/AccountPicker'
import CategoryPicker from '../../components/categories/CategoryPicker'
import WorkspaceReadOnlyBanner from '../../components/workspaces/WorkspaceReadOnlyBanner'
import { useWorkspace } from '../../hooks/useWorkspace'
import type {
    ColumnMapping,
    ImportDuplicateAction,
    ImportParseResponse,
    ImportPreviewItem,
    ImportPreviewResponse,
} from '../../types/api'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency, formatDisplayDate } from '../../utils/format'
import {
    commitImport,
    IMPORT_ACCEPT,
    parseImportFile,
    previewImport,
    validateImportFile,
} from '../../utils/importApi'
import { buildWorkspaceBodyFields } from '../../utils/workspaceScope'

type WizardStep = 'upload' | 'mapping' | 'account' | 'preview' | 'done'

const STEP_LABELS: Record<WizardStep, string> = {
    upload: 'Upload',
    mapping: 'Map columns',
    account: 'Account',
    preview: 'Preview',
    done: 'Complete',
}

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
    { key: 'date', label: 'Date', required: true },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount' },
    { key: 'debit', label: 'Debit' },
    { key: 'credit', label: 'Credit' },
    { key: 'type', label: 'Type (optional)' },
]

const ImportTransactions = () => {
    const navigate = useNavigate()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const { activeWorkspaceId, canEdit, isPersonal, activeWorkspace } = useWorkspace()

    const [step, setStep] = useState<WizardStep>('upload')
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [parseResult, setParseResult] = useState<ImportParseResponse | null>(null)
    const [mapping, setMapping] = useState<ColumnMapping>({})
    const [accountId, setAccountId] = useState('')
    const [defaultCategoryId, setDefaultCategoryId] = useState('')
    const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
    const [rowDecisions, setRowDecisions] = useState<Record<number, ImportDuplicateAction>>({})
    const [importedCount, setImportedCount] = useState(0)
    const [mergedCount, setMergedCount] = useState(0)
    const [loading, setLoading] = useState(false)

    const workspaceFields = useMemo(
        () => buildWorkspaceBodyFields(activeWorkspaceId),
        [activeWorkspaceId]
    )

    const visibleSteps = useMemo(() => {
        if (parseResult?.requiresMapping === false) {
            return ['upload', 'account', 'preview', 'done'] as WizardStep[]
        }
        return ['upload', 'mapping', 'account', 'preview', 'done'] as WizardStep[]
    }, [parseResult?.requiresMapping])

    const resetWizard = () => {
        setStep('upload')
        setSelectedFile(null)
        setParseResult(null)
        setMapping({})
        setAccountId('')
        setDefaultCategoryId('')
        setPreview(null)
        setRowDecisions({})
        setImportedCount(0)
        setMergedCount(0)
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const handleFileSelect = async (file: File) => {
        const validationError = validateImportFile(file)
        if (validationError) {
            toast.error(validationError)
            return
        }

        setLoading(true)
        try {
            const result = await parseImportFile(file)
            setSelectedFile(file)
            setParseResult(result)
            setMapping(result.suggestedMapping ?? {})
            setStep(result.requiresMapping ? 'mapping' : 'account')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to parse import file'))
        } finally {
            setLoading(false)
        }
    }

    const buildPreviewPayload = useCallback(() => {
        if (!parseResult) {
            return null
        }

        const base = {
            accountId,
            defaultCategoryId,
            ...workspaceFields,
        }

        if (parseResult.parsedRows) {
            return {
                ...base,
                parsedRows: parseResult.parsedRows,
            }
        }

        return {
            ...base,
            headers: parseResult.headers,
            rows: parseResult.rows,
            mapping,
        }
    }, [accountId, defaultCategoryId, mapping, parseResult, workspaceFields])

    const loadPreview = async () => {
        const payload = buildPreviewPayload()
        if (!payload) {
            return
        }

        setLoading(true)
        try {
            const result = await previewImport(payload)
            setPreview(result)
            const defaultDecisions: Record<number, ImportDuplicateAction> = {}
            for (const item of result.items) {
                if (item.duplicateOf) {
                    defaultDecisions[item.rowIndex] = item.duplicateAction ?? 'skip'
                }
            }
            setRowDecisions(defaultDecisions)
            setStep('preview')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to build import preview'))
        } finally {
            setLoading(false)
        }
    }

    const handleCommit = async () => {
        const payload = buildPreviewPayload()
        if (!payload) {
            return
        }

        setLoading(true)
        try {
            const result = await commitImport({
                ...payload,
                rowDecisions,
            })
            setImportedCount(result.imported)
            setMergedCount(result.merged)
            setStep('done')
            const parts: string[] = []
            if (result.imported > 0) {
                parts.push(`imported ${result.imported}`)
            }
            if (result.merged > 0) {
                parts.push(`merged ${result.merged}`)
            }
            if (result.skipped > 0) {
                parts.push(`skipped ${result.skipped}`)
            }
            toast.success(
                parts.length > 0
                    ? `Import complete: ${parts.join(', ')}`
                    : 'Import complete'
            )
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to import transactions'))
        } finally {
            setLoading(false)
        }
    }

    const updateMapping = (field: keyof ColumnMapping, value: string) => {
        setMapping((current) => ({
            ...current,
            [field]: value || undefined,
        }))
    }

    const mappingValid = Boolean(mapping.date && (mapping.amount || mapping.debit || mapping.credit))
    const accountStepValid = Boolean(accountId && defaultCategoryId)

    const resolveRowAction = useCallback(
        (item: ImportPreviewItem): ImportDuplicateAction => {
            if (!item.duplicateOf) {
                return 'import'
            }
            return rowDecisions[item.rowIndex] ?? item.duplicateAction ?? 'skip'
        },
        [rowDecisions]
    )

    const importableCount = useMemo(() => {
        if (!preview) {
            return 0
        }
        return preview.items.filter((item) => !item.error && resolveRowAction(item) === 'import')
            .length
    }, [preview, resolveRowAction])

    const mergeCount = useMemo(() => {
        if (!preview) {
            return 0
        }
        return preview.items.filter((item) => !item.error && resolveRowAction(item) === 'merge')
            .length
    }, [preview, resolveRowAction])

    const setDuplicateAction = (rowIndex: number, action: ImportDuplicateAction) => {
        setRowDecisions((current) => ({
            ...current,
            [rowIndex]: action,
        }))
    }

    const setAllDuplicateActions = (action: ImportDuplicateAction) => {
        if (!preview) {
            return
        }
        const next: Record<number, ImportDuplicateAction> = { ...rowDecisions }
        for (const item of preview.items) {
            if (item.duplicateOf) {
                next[item.rowIndex] = action
            }
        }
        setRowDecisions(next)
    }

    if (!canEdit) {
        return (
            <div>
                <PageHeader
                    title="Import transactions"
                    description="Upload a bank CSV or OFX file to import transactions"
                />
                <WorkspaceReadOnlyBanner />
                <div className="card p-6 text-sm text-text-muted">
                    You have view-only access in this workspace and cannot import transactions.
                </div>
            </div>
        )
    }

    return (
        <div>
            <PageHeader
                title="Import transactions"
                description={
                    isPersonal
                        ? 'Upload a bank CSV or OFX export and map columns before importing'
                        : `Import into ${activeWorkspace?.name ?? 'workspace'}`
                }
                actions={
                    <Link
                        to="/transactions"
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-accent/30 text-accent hover:bg-accent-subtle transition-colors"
                    >
                        <IoArrowBack size={16} />
                        Back to transactions
                    </Link>
                }
            />

            <WorkspaceReadOnlyBanner />

            <div className="card mb-6 p-4">
                <div className="flex flex-wrap gap-2">
                    {visibleSteps.map((wizardStep) => {
                        const isActive = step === wizardStep
                        const isComplete = visibleSteps.indexOf(wizardStep) < visibleSteps.indexOf(step)
                        return (
                            <div
                                key={wizardStep}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                                    isActive
                                        ? 'bg-accent text-white'
                                        : isComplete
                                          ? 'bg-accent/15 text-accent'
                                          : 'bg-surface-muted text-text-muted'
                                }`}
                            >
                                {STEP_LABELS[wizardStep]}
                            </div>
                        )
                    })}
                </div>
            </div>

            {step === 'upload' && (
                <div className="card p-6 space-y-4">
                    <p className="text-sm text-text-muted">
                        Supported formats: generic CSV, Chase-style CSV, spndr export CSV, and OFX/QFX
                        bank exports. Maximum 2 MB and 2,000 rows.
                    </p>
                    <label className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-accent/30 bg-accent-subtle/40 px-6 py-10 cursor-pointer hover:bg-accent-subtle/60 transition-colors">
                        <IoCloudUploadOutline size={36} className="text-accent" />
                        <span className="text-sm font-medium text-text-primary">
                            {selectedFile ? selectedFile.name : 'Choose CSV or OFX file'}
                        </span>
                        <span className="text-xs text-text-muted">Click to browse</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={IMPORT_ACCEPT}
                            className="hidden"
                            disabled={loading}
                            onChange={(event) => {
                                const file = event.target.files?.[0]
                                if (file) {
                                    void handleFileSelect(file)
                                }
                            }}
                        />
                    </label>
                    {loading && <p className="text-sm text-text-muted">Parsing file...</p>}
                </div>
            )}

            {step === 'mapping' && parseResult?.headers && (
                <div className="card p-6 space-y-5">
                    <div>
                        <h2 className="font-display text-lg font-semibold text-text-primary">
                            Map columns
                        </h2>
                        <p className="mt-1 text-sm text-text-muted">
                            Detected {parseResult.format} format with {parseResult.totalRows} rows.
                            Match your file columns to transaction fields.
                        </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        {MAPPING_FIELDS.map((field) => (
                            <div key={field.key}>
                                <label className="text-[13px] text-fg-secondary">
                                    {field.label}
                                    {field.required && <span className="text-expense ml-0.5">*</span>}
                                </label>
                                <div className="input-box mb-0 mt-1">
                                    <select
                                        value={mapping[field.key] ?? ''}
                                        onChange={(event) =>
                                            updateMapping(field.key, event.target.value)
                                        }
                                        className="w-full bg-transparent outline-none"
                                    >
                                        <option value="">Not mapped</option>
                                        {parseResult.headers?.map((header) => (
                                            <option key={header} value={header}>
                                                {header}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        ))}
                    </div>

                    {parseResult.sampleRows.length > 0 && Array.isArray(parseResult.sampleRows[0]) && (
                        <div className="overflow-x-auto">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                                Sample rows
                            </p>
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border">
                                        {parseResult.headers.map((header) => (
                                            <th
                                                key={header}
                                                className="px-3 py-2 text-left font-medium text-text-muted"
                                            >
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(parseResult.sampleRows as string[][]).map((row, index) => (
                                        <tr key={index} className="border-b border-border/60">
                                            {row.map((cell, cellIndex) => (
                                                <td key={cellIndex} className="px-3 py-2 text-text-primary">
                                                    {cell}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={resetWizard}
                            className="px-4 py-2 text-sm rounded-lg border border-border text-text-muted hover:text-text-primary"
                        >
                            Start over
                        </button>
                        <button
                            type="button"
                            disabled={!mappingValid}
                            onClick={() => setStep('account')}
                            className="px-4 py-2 text-sm rounded-lg btn-accent disabled:opacity-50"
                        >
                            Continue
                        </button>
                    </div>
                </div>
            )}

            {step === 'account' && (
                <div className="card p-6 space-y-5">
                    <div>
                        <h2 className="font-display text-lg font-semibold text-text-primary">
                            Assign account
                        </h2>
                        <p className="mt-1 text-sm text-text-muted">
                            All imported transactions will post to the selected account. Categorization
                            rules run automatically; unmatched rows use the default category.
                        </p>
                    </div>

                    <AccountPicker value={accountId} onChange={setAccountId} required />
                    <CategoryPicker
                        value={defaultCategoryId}
                        onChange={setDefaultCategoryId}
                        label="Default category"
                        required
                    />

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={() =>
                                setStep(parseResult?.requiresMapping ? 'mapping' : 'upload')
                            }
                            className="px-4 py-2 text-sm rounded-lg border border-border text-text-muted hover:text-text-primary"
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            disabled={!accountStepValid || loading}
                            onClick={() => void loadPreview()}
                            className="px-4 py-2 text-sm rounded-lg btn-accent disabled:opacity-50"
                        >
                            {loading ? 'Building preview...' : 'Preview import'}
                        </button>
                    </div>
                </div>
            )}

            {step === 'preview' && preview && (
                <div className="space-y-4">
                    <div className="card p-6">
                        <h2 className="font-display text-lg font-semibold text-text-primary">
                            Review before import
                        </h2>
                        <div className="mt-4 grid gap-3 sm:grid-cols-5">
                            <SummaryStat label="Total rows" value={String(preview.summary.total)} />
                            <SummaryStat label="Valid" value={String(preview.summary.valid)} />
                            <SummaryStat
                                label="Duplicates"
                                value={String(preview.summary.duplicates)}
                            />
                            <SummaryStat
                                label="Income"
                                value={formatCurrency(preview.summary.incomeTotal)}
                            />
                            <SummaryStat
                                label="Expense"
                                value={formatCurrency(preview.summary.expenseTotal)}
                            />
                        </div>
                        {preview.summary.duplicates > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setAllDuplicateActions('skip')}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-text-primary"
                                >
                                    Skip all duplicates
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAllDuplicateActions('import')}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-text-primary"
                                >
                                    Import all duplicates
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAllDuplicateActions('merge')}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-text-primary"
                                >
                                    Merge all duplicates
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="card overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-surface-muted/40">
                                        <th className="px-3 py-2 text-left">#</th>
                                        <th className="px-3 py-2 text-left">Date</th>
                                        <th className="px-3 py-2 text-left">Description</th>
                                        <th className="px-3 py-2 text-left">Type</th>
                                        <th className="px-3 py-2 text-left">Amount</th>
                                        <th className="px-3 py-2 text-left">Category</th>
                                        <th className="px-3 py-2 text-left">Rule</th>
                                        <th className="px-3 py-2 text-left">Duplicate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.items.map((item) => (
                                        <PreviewRow
                                            key={item.rowIndex}
                                            item={item}
                                            action={resolveRowAction(item)}
                                            onActionChange={setDuplicateAction}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => setStep('account')}
                            className="px-4 py-2 text-sm rounded-lg border border-border text-text-muted hover:text-text-primary"
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            disabled={loading || (importableCount === 0 && mergeCount === 0)}
                            onClick={() => void handleCommit()}
                            className="px-4 py-2 text-sm rounded-lg btn-accent disabled:opacity-50"
                        >
                            {loading
                                ? 'Importing...'
                                : `Confirm import (${importableCount} new${mergeCount > 0 ? `, ${mergeCount} merge` : ''})`}
                        </button>
                    </div>
                </div>
            )}

            {step === 'done' && (
                <div className="card p-8 text-center space-y-4">
                    <IoCheckmarkCircle size={48} className="mx-auto text-accent" />
                    <h2 className="font-display text-xl font-semibold text-text-primary">
                        Import complete
                    </h2>
                    <p className="text-sm text-text-muted">
                        {importedCount > 0 && (
                            <>
                                Imported {importedCount} new transaction
                                {importedCount === 1 ? '' : 's'}.
                            </>
                        )}
                        {importedCount > 0 && mergedCount > 0 && ' '}
                        {mergedCount > 0 && (
                            <>
                                Merged {mergedCount} existing transaction
                                {mergedCount === 1 ? '' : 's'}.
                            </>
                        )}
                        {importedCount === 0 && mergedCount === 0 && 'No transactions were changed.'}
                    </p>
                    <div className="flex justify-center gap-3 pt-2">
                        <button
                            type="button"
                            onClick={resetWizard}
                            className="px-4 py-2 text-sm rounded-lg border border-border text-text-muted hover:text-text-primary"
                        >
                            Import another file
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/transactions')}
                            className="px-4 py-2 text-sm rounded-lg btn-accent"
                        >
                            View transactions
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

interface SummaryStatProps {
    label: string
    value: string
}

const SummaryStat: React.FC<SummaryStatProps> = ({ label, value }) => (
    <div className="rounded-lg border border-border px-3 py-2">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="mt-1 font-medium text-text-primary">{value}</p>
    </div>
)

interface PreviewRowProps {
    item: ImportPreviewItem
    action: ImportDuplicateAction
    onActionChange: (rowIndex: number, action: ImportDuplicateAction) => void
}

const PreviewRow: React.FC<PreviewRowProps> = ({ item, action, onActionChange }) => (
    <tr
        className={`border-b border-border/60 ${
            item.error ? 'bg-expense/5' : item.duplicateOf ? 'bg-amber-500/5' : ''
        }`}
    >
        <td className="px-3 py-2 text-text-muted">{item.rowIndex}</td>
        <td className="px-3 py-2">{item.date ? formatDisplayDate(item.date) : '—'}</td>
        <td className="px-3 py-2">
            <div className="font-medium text-text-primary">{item.title || '—'}</div>
            {item.error && <div className="text-xs text-expense">{item.error}</div>}
            {item.duplicateOf && (
                <div className="mt-1 text-xs text-text-muted">
                    Matches: {item.duplicateOf.title} ({formatDisplayDate(item.duplicateOf.date)},{' '}
                    {formatCurrency(item.duplicateOf.amount)})
                </div>
            )}
        </td>
        <td className="px-3 py-2 capitalize">{item.type}</td>
        <td className="px-3 py-2">{item.amount ? formatCurrency(item.amount) : '—'}</td>
        <td className="px-3 py-2">{item.categoryName ?? '—'}</td>
        <td className="px-3 py-2 text-text-muted">{item.appliedRuleName ?? '—'}</td>
        <td className="px-3 py-2">
            {item.duplicateOf ? (
                <select
                    value={action}
                    onChange={(event) =>
                        onActionChange(item.rowIndex, event.target.value as ImportDuplicateAction)
                    }
                    className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                >
                    <option value="skip">Skip</option>
                    <option value="import">Import anyway</option>
                    <option value="merge">Merge</option>
                </select>
            ) : (
                <span className="text-xs text-text-muted">New</span>
            )}
        </td>
    </tr>
)

export default ImportTransactions
