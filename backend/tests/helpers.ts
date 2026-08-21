import request from 'supertest'
import jwt from 'jsonwebtoken'
import { Application } from 'express'
import User from '../models/User'

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

    const res = await request(app).post('/api/v1/auth/register').send(userData)

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
