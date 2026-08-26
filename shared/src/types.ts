/**
 * Domain-wide primitive types shared between the backend (Mongo/Express) and
 * the frontend's local-first SQLite store. Kept dependency-free so this
 * package can be imported as plain TS source from either workspace.
 */

export type AccountType = 'checking' | 'cash' | 'credit' | 'savings'

export type TransactionType = 'income' | 'expense' | 'transfer'

export type TransactionStatus = 'posted' | 'draft'

export type RecurringInterval =
    | 'daily'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'quarterly'
    | 'yearly'
    | 'custom'
