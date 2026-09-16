import { toDateInputValue } from '@lib/format'
import type { SplitLineFormData, TransactionFormData, TransactionType, TransferFormData } from './types'
import type { SortField, StatusFilter, TypeFilter } from './hooks/useTransactionsData'

export const emptySplitLine = (): SplitLineFormData => ({ categoryId: '', amount: '' })

export const emptyForm = (type: 'income' | 'expense' = 'expense'): TransactionFormData => ({
    type,
    title: '',
    amount: '',
    date: toDateInputValue(new Date()),
    accountId: '',
    categoryId: '',
    description: '',
    source: '',
    paymentMethod: '',
    tags: [],
    splitEnabled: false,
    splits: [emptySplitLine(), emptySplitLine()],
})

export const emptyTransferForm = (): TransferFormData => ({
    title: '',
    amount: '',
    date: toDateInputValue(new Date()),
    fromAccountId: '',
    toAccountId: '',
    description: '',
})

export const TYPE_TABS: { value: TypeFilter; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'income', label: 'Income' },
    { value: 'expense', label: 'Expense' },
    { value: 'transfer', label: 'Transfer' },
]

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'posted', label: 'Posted' },
    { value: 'draft', label: 'Draft' },
]

export const SORT_OPTIONS: { value: SortField; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'amount', label: 'Amount' },
    { value: 'category', label: 'Category' },
]

export const transactionUserLabel = (type: TransactionType, name: string): string => {
    if (type === 'income') return `Received by ${name}`
    if (type === 'expense') return `Paid by ${name}`
    return `By ${name}`
}

export const amountColor = (type: TransactionType): string => {
    if (type === 'income') return 'text-accent'
    if (type === 'expense') return 'text-expense'
    return 'text-violet-400'
}

/** Transfer legs carry no sign of their own (`type` is `'transfer'` for both the outbound and
 * inbound leg) - `transferDirection`, resolved server/domain-side from creation order relative to
 * the paired leg, is what lets the two rows read as opposite ends of one move instead of a
 * duplicate. Falls back to no sign when direction can't be resolved (e.g. the pair isn't loaded). */
export const amountPrefix = (type: TransactionType, transferDirection?: 'out' | 'in'): string => {
    if (type === 'income') return '+'
    if (type === 'expense') return '−'
    if (transferDirection === 'in') return '+'
    if (transferDirection === 'out') return '−'
    return ''
}
