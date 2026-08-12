import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import app from '../app'
import Account from '../models/Account'
import Category from '../models/Category'
import Expense from '../models/Expense'
import Income from '../models/Income'
import Transaction from '../models/Transaction'
import { ensureMasterCategoriesSeeded } from '../utils/categorySeed'
import { migrateLegacyLedgerToTransactions } from '../utils/migrateLegacyTransactions'
import { authHeader, registerUser, seedUserDirectly } from './helpers'

async function seedLegacyLedger(userId: Types.ObjectId) {
    await ensureMasterCategoriesSeeded()

    const income = await Income.create({
        userId,
        title: 'Freelance',
        amount: 500,
        date: new Date('2026-01-10T12:00:00.000Z'),
        source: 'Client A',
    })

    const expense = await Expense.create({
        userId,
        title: 'Lunch',
        amount: 25.5,
        category: 'Food',
        date: new Date('2026-01-11T12:00:00.000Z'),
        paymentMethod: 'card',
    })

    return { income, expense }
}

async function getMasterCategoryId(name: string): Promise<Types.ObjectId> {
    const category = await Category.findOne({ userId: null, name })
    if (!category) {
        throw new Error(`Master category not found: ${name}`)
    }
    return category._id
}

describe('migrateLegacyLedgerToTransactions', () => {
    it('migrates income and expense records with correct types and minor-unit amounts', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-basic@example.com' })
        const { income, expense } = await seedLegacyLedger(new Types.ObjectId(userId))

        const result = await migrateLegacyLedgerToTransactions()

        expect(result.incomeMigrated).toBe(1)
        expect(result.expenseMigrated).toBe(1)
        expect(result.incomeSkipped).toBe(0)
        expect(result.expenseSkipped).toBe(0)

        const incomeTx = await Transaction.findById(income._id)
        const expenseTx = await Transaction.findById(expense._id)

        expect(incomeTx?.type).toBe('income')
        expect(incomeTx?.amount).toBe(50000)
        expect(incomeTx?.source).toBe('Client A')

        expect(expenseTx?.type).toBe('expense')
        expect(expenseTx?.amount).toBe(2550)
        expect(expenseTx?.paymentMethod).toBe('card')
    })

    it('creates a default Primary account when the user has none', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-account@example.com' })
        await seedLegacyLedger(new Types.ObjectId(userId))

        const result = await migrateLegacyLedgerToTransactions()

        expect(result.accountsCreated).toBe(1)

        const account = await Account.findOne({ userId, isDefault: true })
        expect(account).not.toBeNull()
        expect(account?.name).toBe('Primary')
        expect(account?.type).toBe('checking')
    })

    it('uses an existing account instead of creating a new one', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-existing-account@example.com' })
        const userObjectId = new Types.ObjectId(userId)

        const existingAccount = await Account.create({
            userId: userObjectId,
            name: 'My Checking',
            type: 'checking',
            currency: 'USD',
            openingBalance: 100,
            currentBalance: 100,
            isDefault: true,
            isArchived: false,
        })

        await seedLegacyLedger(userObjectId)

        const result = await migrateLegacyLedgerToTransactions()

        expect(result.accountsCreated).toBe(0)

        const accountCount = await Account.countDocuments({ userId })
        expect(accountCount).toBe(1)

        const migrated = await Transaction.findOne({ userId, type: 'income' })
        expect(migrated?.accountId.toString()).toBe(existingAccount._id.toString())
    })

    it('maps string categories to master category FK refs', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-category@example.com' })
        const userObjectId = new Types.ObjectId(userId)
        await ensureMasterCategoriesSeeded()

        const foodMasterId = await getMasterCategoryId('Food')

        await Expense.create({
            userId: userObjectId,
            title: 'Groceries',
            amount: 40,
            category: 'Food',
            date: new Date('2026-01-01T12:00:00.000Z'),
        })

        const result = await migrateLegacyLedgerToTransactions()

        expect(result.categoriesMapped).toBe(1)
        expect(result.categoriesFallback).toBe(0)

        const tx = await Transaction.findOne({ userId, type: 'expense' })
        expect(tx?.categoryId.toString()).toBe(foodMasterId.toString())
    })

    it('falls back to Other for unknown expense categories', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-fallback@example.com' })
        const userObjectId = new Types.ObjectId(userId)
        await ensureMasterCategoriesSeeded()

        const otherMasterId = await getMasterCategoryId('Other')

        await Expense.create({
            userId: userObjectId,
            title: 'Mystery charge',
            amount: 10,
            category: 'Nonexistent Category',
            date: new Date('2026-01-01T12:00:00.000Z'),
        })

        const result = await migrateLegacyLedgerToTransactions()

        expect(result.categoriesFallback).toBe(1)

        const tx = await Transaction.findOne({ userId, type: 'expense' })
        expect(tx?.categoryId.toString()).toBe(otherMasterId.toString())
    })

    it('maps user sub-categories by name', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-subcategory@example.com' })
        const userObjectId = new Types.ObjectId(userId)
        await ensureMasterCategoriesSeeded()

        const foodMasterId = await getMasterCategoryId('Food')
        const subCategory = await Category.create({
            userId: userObjectId,
            masterCategoryId: foodMasterId,
            name: 'Coffee Shops',
            icon: 'coffee',
            color: '#111111',
            isDefault: false,
            isArchived: false,
            sortOrder: 0,
        })

        await Expense.create({
            userId: userObjectId,
            title: 'Latte',
            amount: 6,
            category: 'Coffee Shops',
            date: new Date('2026-01-01T12:00:00.000Z'),
        })

        const result = await migrateLegacyLedgerToTransactions()

        expect(result.categoriesMapped).toBe(1)

        const tx = await Transaction.findOne({ userId, type: 'expense' })
        expect(tx?.categoryId.toString()).toBe(subCategory._id.toString())
    })

    it('updates account balance from migrated income and expense totals', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-balance@example.com' })
        await seedLegacyLedger(new Types.ObjectId(userId))

        await migrateLegacyLedgerToTransactions()

        const account = await Account.findOne({ userId, isDefault: true })
        expect(account?.currentBalance).toBe(474.5)
    })

    it('is idempotent - re-run skips already-migrated records', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-idempotent@example.com' })
        await seedLegacyLedger(new Types.ObjectId(userId))

        const first = await migrateLegacyLedgerToTransactions()
        expect(first.incomeMigrated).toBe(1)
        expect(first.expenseMigrated).toBe(1)

        const accountAfterFirst = await Account.findOne({ userId })
        const balanceAfterFirst = accountAfterFirst?.currentBalance

        const second = await migrateLegacyLedgerToTransactions()
        expect(second.incomeSkipped).toBe(1)
        expect(second.expenseSkipped).toBe(1)
        expect(second.incomeMigrated).toBe(0)
        expect(second.expenseMigrated).toBe(0)
        expect(second.accountsCreated).toBe(0)

        const txCount = await Transaction.countDocuments({ userId })
        expect(txCount).toBe(2)

        const accountAfterSecond = await Account.findOne({ userId })
        expect(accountAfterSecond?.currentBalance).toBe(balanceAfterFirst)
    })

    it('dry run reports counts without persisting transactions or accounts', async () => {
        const { userId } = await seedUserDirectly({ email: 'migrate-dry-run@example.com' })
        await seedLegacyLedger(new Types.ObjectId(userId))

        const result = await migrateLegacyLedgerToTransactions({ dryRun: true })

        expect(result.dryRun).toBe(true)
        expect(result.incomeMigrated).toBe(1)
        expect(result.expenseMigrated).toBe(1)
        expect(result.accountsCreated).toBe(1)

        expect(await Transaction.countDocuments({ userId })).toBe(0)
        expect(await Account.countDocuments({ userId })).toBe(0)
    })
})

describe('Legacy ledger route deprecation', () => {
    it('returns Deprecation headers and _deprecated payload on income routes', async () => {
        const { token } = await seedUserDirectly({ email: 'deprecation-income@example.com' })

        const res = await request(app)
            .get('/api/v1/income')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.headers.deprecation).toBe('true')
        expect(res.headers.link).toContain('/api/v1/transactions')
        expect(res.body._deprecated).toMatchObject({
            deprecation: true,
            successor: '/api/v1/transactions',
        })
    })

    it('returns Deprecation headers and _deprecated payload on expense routes', async () => {
        const { token } = await registerUser(app, {
            email: 'deprecation-expense@example.com',
        })

        const res = await request(app)
            .get('/api/v1/expense')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.headers.deprecation).toBe('true')
        expect(res.headers.link).toContain('/api/v1/transactions')
        expect(res.body._deprecated).toMatchObject({
            deprecation: true,
            successor: '/api/v1/transactions',
        })
    })
})
