import { Types } from 'mongoose'

import Account, { IAccount } from '../models/Account'
import Category, { ICategory } from '../models/Category'
import Expense, { IExpense } from '../models/Expense'
import Income, { IIncome } from '../models/Income'
import Transaction, { TransactionType } from '../models/Transaction'
import { ensureMasterCategoriesSeeded } from './categorySeed'
import { toMinorUnits } from '@core/money/moneyUtils'
import { applyTransactionToAccount } from './transactionUtils'

export interface MigrationOptions {
    dryRun?: boolean
}

export interface MigrationResult {
    dryRun: boolean
    incomeMigrated: number
    incomeSkipped: number
    expenseMigrated: number
    expenseSkipped: number
    accountsCreated: number
    categoriesMapped: number
    categoriesFallback: number
}

interface CategoryLookup {
    masterByName: Map<string, ICategory>
    userByName: Map<string, ICategory>
}

const normalizeCategoryName = (name: string): string => name.trim().toLowerCase()

const buildCategoryLookup = async (userId: Types.ObjectId): Promise<CategoryLookup> => {
    const categories = await Category.find({
        $or: [{ userId: null }, { userId, isArchived: false }],
    })

    const masterByName = new Map<string, ICategory>()
    const userByName = new Map<string, ICategory>()

    for (const category of categories) {
        const key = normalizeCategoryName(category.name)
        if (category.userId == null) {
            masterByName.set(key, category)
        } else {
            userByName.set(key, category)
        }
    }

    return { masterByName, userByName }
}

const resolveCategoryId = (
    lookup: CategoryLookup,
    categoryName: string | undefined,
    type: 'income' | 'expense'
): { categoryId: Types.ObjectId; usedFallback: boolean } => {
    const normalized = categoryName?.trim()
    if (normalized) {
        const key = normalizeCategoryName(normalized)
        const userMatch = lookup.userByName.get(key)
        if (userMatch) {
            return { categoryId: userMatch._id, usedFallback: false }
        }

        const masterMatch = lookup.masterByName.get(key)
        if (masterMatch) {
            return { categoryId: masterMatch._id, usedFallback: false }
        }
    }

    const fallbackName = type === 'income' ? 'Income' : 'Other'
    const fallback =
        lookup.masterByName.get(normalizeCategoryName(fallbackName)) ??
        [...lookup.masterByName.values()][0]

    if (!fallback) {
        throw new Error('Master categories are not seeded')
    }

    return { categoryId: fallback._id, usedFallback: true }
}

const resolveAccountForUser = async (
    userId: Types.ObjectId,
    dryRun: boolean
): Promise<{ account: IAccount; created: boolean }> => {
    const existing =
        (await Account.findOne({ userId, isArchived: false, isDefault: true })) ??
        (await Account.findOne({ userId, isArchived: false }).sort({ createdAt: 1 }))

    if (existing) {
        return { account: existing, created: false }
    }

    if (dryRun) {
        return {
            account: {
                _id: new Types.ObjectId(),
                currency: 'USD',
            } as IAccount,
            created: true,
        }
    }

    const account = await Account.create({
        userId,
        name: 'Primary',
        type: 'checking',
        currency: 'USD',
        openingBalance: 0,
        currentBalance: 0,
        isDefault: true,
        isArchived: false,
    })

    return { account, created: true }
}

const migrateRecord = async (params: {
    userId: Types.ObjectId
    account: IAccount
    categoryId: Types.ObjectId
    type: TransactionType
    legacyId: Types.ObjectId
    title: string
    amountMajor: number
    date: Date
    description?: string
    source?: string
    paymentMethod?: string
    tags?: string[]
    dryRun: boolean
}): Promise<'migrated' | 'skipped'> => {
    const existing = await Transaction.findById(params.legacyId).select('_id')
    if (existing) {
        return 'skipped'
    }

    if (params.dryRun) {
        return 'migrated'
    }

    const amountMinor = toMinorUnits(params.amountMajor)

    await Transaction.create({
        _id: params.legacyId,
        userId: params.userId,
        accountId: params.account._id,
        categoryId: params.categoryId,
        type: params.type,
        status: 'posted',
        amount: amountMinor,
        currency: params.account.currency,
        title: params.title,
        description: params.description,
        date: params.date,
        source: params.source,
        paymentMethod: params.paymentMethod,
        tags: params.tags,
    })

    await applyTransactionToAccount(params.account, params.type, amountMinor, params.date)

    return 'migrated'
}

export const migrateLegacyLedgerToTransactions = async (
    options: MigrationOptions = {}
): Promise<MigrationResult> => {
    const dryRun = options.dryRun ?? false

    await ensureMasterCategoriesSeeded()

    const result: MigrationResult = {
        dryRun,
        incomeMigrated: 0,
        incomeSkipped: 0,
        expenseMigrated: 0,
        expenseSkipped: 0,
        accountsCreated: 0,
        categoriesMapped: 0,
        categoriesFallback: 0,
    }

    const userIds = new Set<string>()
    for (const doc of await Income.find().select('userId')) {
        userIds.add(doc.userId.toString())
    }
    for (const doc of await Expense.find().select('userId')) {
        userIds.add(doc.userId.toString())
    }

    for (const userIdStr of userIds) {
        const userId = new Types.ObjectId(userIdStr)
        const lookup = await buildCategoryLookup(userId)
        const { account, created } = await resolveAccountForUser(userId, dryRun)

        if (created) {
            result.accountsCreated += 1
        }

        const incomes: IIncome[] = await Income.find({ userId }).sort({ date: 1 })
        for (const income of incomes) {
            const { categoryId, usedFallback } = resolveCategoryId(
                lookup,
                income.category,
                'income'
            )

            if (usedFallback) {
                result.categoriesFallback += 1
            } else {
                result.categoriesMapped += 1
            }

            const status = await migrateRecord({
                userId,
                account,
                categoryId,
                type: 'income',
                legacyId: new Types.ObjectId(income.id),
                title: income.title,
                amountMajor: income.amount,
                date: income.date,
                description: income.description,
                source: income.source,
                dryRun,
            })

            if (status === 'migrated') {
                result.incomeMigrated += 1
            } else {
                result.incomeSkipped += 1
            }
        }

        const expenses: IExpense[] = await Expense.find({ userId }).sort({ date: 1 })
        for (const expense of expenses) {
            const { categoryId, usedFallback } = resolveCategoryId(
                lookup,
                expense.category,
                'expense'
            )

            if (usedFallback) {
                result.categoriesFallback += 1
            } else {
                result.categoriesMapped += 1
            }

            const status = await migrateRecord({
                userId,
                account,
                categoryId,
                type: 'expense',
                legacyId: new Types.ObjectId(expense.id),
                title: expense.title,
                amountMajor: expense.amount,
                date: expense.date,
                description: expense.description,
                paymentMethod: expense.paymentMethod,
                tags: expense.tags,
                dryRun,
            })

            if (status === 'migrated') {
                result.expenseMigrated += 1
            } else {
                result.expenseSkipped += 1
            }
        }
    }

    return result
}
