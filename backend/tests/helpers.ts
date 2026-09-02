import request from 'supertest'
import jwt from 'jsonwebtoken'
import { Application } from 'express'
import { Types } from 'mongoose'
import { User } from '@modules/users'
import { Transaction } from '@modules/transactions'
import { toMinorUnits } from '@shared/money'

export interface TestUser {
    fullName: string
    email: string
    password: string
}

export interface RegisteredUser {
    token: string
    userId: string
    email: string
}

const defaultTestUser: TestUser = {
    fullName: 'Test User',
    email: 'test@example.com',
    password: 'TestPassword123!',
}

export async function registerUser(
    app: Application,
    overrides: Partial<TestUser> = {}
): Promise<RegisteredUser> {
    const userData = { ...defaultTestUser, ...overrides }

    // Signup requires an explicit consent + 18+ attestation (M0c). Every test that isn't
    // specifically exercising that gate wants a user who cleared it, so it's defaulted here
    // rather than in each caller - same reasoning as the auto-verify below.
    // See tests/legalAcceptance.test.ts for the specs that omit these deliberately.
    const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...userData, acceptedTerms: true, ageAttested: true })

    // Auto-verify so existing/unrelated tests can keep using protected routes right after
    // registering, without every caller needing to know about the email-verification flow.
    // Tests that specifically exercise the unverified state register via raw HTTP instead
    // (see tests/emailVerification.test.ts).
    await User.findByIdAndUpdate(res.body.data.user._id, { isEmailVerified: true })

    return {
        token: res.body.data.token,
        userId: res.body.data.user._id,
        email: userData.email,
    }
}

export async function createSecondUser(app: Application): Promise<RegisteredUser> {
    return registerUser(app, {
        fullName: 'Other User',
        email: 'other@example.com',
        password: 'OtherPassword123!',
    })
}

/**
 * Marks an account verified out-of-band. For specs that register via raw HTTP (rather than the
 * auto-verifying `registerUser` helper) but still need the account past the login/verification
 * hard gate.
 */
export async function verifyUserByEmail(email: string): Promise<void> {
    await User.updateOne({ email: email.trim().toLowerCase() }, { $set: { isEmailVerified: true } })
}

export function authHeader(token: string): { Authorization: string } {
    return { Authorization: `Bearer ${token}` }
}

export async function createTestIncome(
    app: Application,
    token: string,
    amount: number,
    title = 'Test Income'
): Promise<void> {
    await request(app)
        .post('/api/v1/income/create')
        .set(authHeader(token))
        .send({
            title,
            amount,
            date: new Date().toISOString(),
        })
}

export async function createTestExpense(
    app: Application,
    token: string,
    amount: number,
    title = 'Test Expense'
): Promise<void> {
    await request(app)
        .post('/api/v1/expense/create')
        .set(authHeader(token))
        .send({
            title,
            amount,
            category: 'Other',
            date: new Date().toISOString(),
        })
}

/**
 * Seeds a posted income/expense Transaction directly (bypassing the
 * `/api/v1/transactions` REST endpoint's account-existence requirement),
 * for tests exercising `computeUserBalances`'s lifetime totals (BUG-01)
 * where the scenario under test deliberately has no active `Account` —
 * `accountId` here is a synthetic id never resolved against a real account,
 * since the aggregation that reads it only matches on `userId`/`type`/
 * `status`/`splitTransactionId`.
 */
export async function createPostedTransaction(
    userId: string,
    type: 'income' | 'expense',
    amountMajor: number,
    title = type === 'income' ? 'Test Income' : 'Test Expense'
): Promise<void> {
    await Transaction.create({
        userId,
        accountId: new Types.ObjectId(),
        categoryId: new Types.ObjectId(),
        type,
        status: 'posted',
        amount: toMinorUnits(amountMajor),
        currency: 'USD',
        title,
        date: new Date(),
    })
}

/**
 * `updatedAt` has millisecond precision, and sync staleness detection compares it as an exact
 * string (`isStaleGeneric` in syncController.ts). A "stale baseUpdatedAt" test captures a doc's
 * `updatedAt`, then mutates and re-saves it - on a fast machine those two writes can land in the
 * same millisecond, so the "changed out from under the client" save produces an `updatedAt`
 * identical to the captured baseline and the conflict goes undetected (flaky "applied" instead of
 * "conflict"). Call this between the capture and the mutating save to force a new millisecond.
 */
export const ensureTimestampAdvances = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 5))

export async function seedUserDirectly(overrides: Partial<TestUser> = {}): Promise<RegisteredUser> {
    const userData = { ...defaultTestUser, ...overrides }
    const user = await User.create({ ...userData, isEmailVerified: true })
    const token = jwt.sign(
        { id: user._id.toString(), tv: user.tokenVersion ?? 0 },
        process.env.JWT_SECRET as string,
        {
        expiresIn: '1h',
    }
    )

    return {
        token,
        userId: user._id.toString(),
        email: userData.email,
    }
}
