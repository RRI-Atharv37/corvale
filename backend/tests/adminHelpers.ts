import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import type { Application } from 'express'
import type { Types } from 'mongoose'

import { createApp } from '@http/app'
import { generateRecoveryCodes, normalizeRecoveryCode, sha256Hex } from '@core/auth/tokenHash'
import { generateTotpCode, generateTotpSecret } from '@core/auth/totp'
import { parseEncryptionKey, sealSecret } from '@core/auth/secretBox'
import { AdminUser } from '@modules/admin'
import type { AdminRole, AdminStatus } from '@modules/admin'

/**
 * Shared harness for the M7 admin suites. The admin surface is mounted only while ADMIN_ENABLED is
 * true, so every suite builds its own app after `enableAdmin()`; the default `@http/app` export stays
 * the admin-less app that the route-drift and 404 checks rely on.
 */

export const ADMIN_ORIGIN = 'http://localhost:5180'
export const ADMIN_JWT_SECRET = 'test-admin-jwt-secret-must-differ-from-user-secret'
export const ADMIN_TOTP_KEY_HEX = 'cd'.repeat(32)
export const ADMIN_PASSWORD = 'correct horse battery staple'
export const BOOTSTRAP_SECRET = 'bootstrap-secret-that-is-at-least-32-characters-long'
export const BREAKGLASS_SECRET = 'break-glass-secret-that-is-at-least-32-characters'

export const ADMIN_BASE = '/api/v1/admin'
export const ADMIN_COOKIE = 'corvale_admin_refresh'

const ADMIN_ENV_KEYS = [
    'ADMIN_ENABLED',
    'ADMIN_JWT_SECRET',
    'ADMIN_ORIGIN',
    'ADMIN_TOTP_ENCRYPTION_KEY',
    'ADMIN_BOOTSTRAP_SECRET_SHA256',
    'ADMIN_BREAKGLASS_SECRET_SHA256',
    'ADMIN_BCRYPT_ROUNDS',
    'ADMIN_LOGIN_RATE_LIMIT_MAX',
    'ADMIN_IP_ALLOWLIST',
    'ADMIN_DETAIL_VIEWS_PER_HOUR',
] as const

export const enableAdmin = (extra: Record<string, string> = {}): void => {
    process.env.ADMIN_ENABLED = 'true'
    process.env.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET
    process.env.ADMIN_ORIGIN = ADMIN_ORIGIN
    process.env.ADMIN_TOTP_ENCRYPTION_KEY = ADMIN_TOTP_KEY_HEX
    process.env.ADMIN_BOOTSTRAP_SECRET_SHA256 = sha256Hex(BOOTSTRAP_SECRET)
    process.env.ADMIN_BREAKGLASS_SECRET_SHA256 = sha256Hex(BREAKGLASS_SECRET)
    process.env.ADMIN_BCRYPT_ROUNDS = '4'
    process.env.ADMIN_LOGIN_RATE_LIMIT_MAX = '200'
    Object.assign(process.env, extra)
}

export const disableAdmin = (): void => {
    for (const key of ADMIN_ENV_KEYS) delete process.env[key]
}

export const buildAdminApp = (extraEnv: Record<string, string> = {}): Application => {
    enableAdmin(extraEnv)
    return createApp()
}

export interface SeededAdmin {
    id: string
    email: string
    password: string
    role: AdminRole
    secret: string
    recoveryCodes: string[]
    /** A code for the step containing `Date.now() + offsetSeconds`. */
    code: (offsetSeconds?: number) => string
}

interface SeedAdminOptions {
    email?: string
    role?: AdminRole
    password?: string
    status?: AdminStatus
    moneyBlockedUntil?: Date | null
}

let adminCounter = 0

export const seedAdmin = async (options: SeedAdminOptions = {}): Promise<SeededAdmin> => {
    adminCounter += 1
    const email = options.email ?? `admin${adminCounter}@ops.example.com`
    const password = options.password ?? ADMIN_PASSWORD
    const secret = generateTotpSecret()
    const recoveryCodes = generateRecoveryCodes()

    const admin = await AdminUser.create({
        email,
        role: options.role ?? 'owner',
        status: options.status ?? 'active',
        passwordHash: await bcrypt.hash(password, 4),
        totpSecretEnc: sealSecret(secret, parseEncryptionKey(ADMIN_TOTP_KEY_HEX)),
        recoveryCodeHashes: recoveryCodes.map((code) => sha256Hex(normalizeRecoveryCode(code))),
        moneyBlockedUntil: options.moneyBlockedUntil ?? null,
    })

    return {
        id: admin._id.toString(),
        email,
        password,
        role: admin.role,
        secret,
        recoveryCodes,
        code: (offsetSeconds = 0) => generateTotpCode(secret, Date.now() + offsetSeconds * 1000),
    }
}

export const postLogin = (app: Application, admin: SeededAdmin, overrides: Record<string, unknown> = {}) =>
    request(app)
        .post(`${ADMIN_BASE}/auth/login`)
        .send({ email: admin.email, password: admin.password, totpCode: admin.code(), ...overrides })

export interface AdminSessionHandle {
    token: string
    cookie: string
}

/** Logs in through the real endpoint. A TOTP step is single-use, so a second login needs `clearTotpReplay`. */
export const loginAsAdmin = async (app: Application, admin: SeededAdmin): Promise<AdminSessionHandle> => {
    const res = await postLogin(app, admin)
    if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${res.body.message}`)
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
    const cookie = cookies.find((value) => value.startsWith(`${ADMIN_COOKIE}=`))
    return { token: res.body.data.accessToken, cookie: cookie ? cookie.split(';')[0] : '' }
}

export const bearer = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` })

/** A TOTP step is single-use; a test that logs the same admin in twice clears the replay guard between calls. */
export const clearTotpReplay = async (adminId: string): Promise<void> => {
    await AdminUser.updateOne({ _id: adminId }, { $set: { totpLastStep: null } })
}

export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS

export const signAdminToken = (
    payload: Record<string, unknown>,
    options: { secret?: string; audience?: string; issuer?: string; expiresIn?: number } = {}
): string =>
    jwt.sign(payload, options.secret ?? ADMIN_JWT_SECRET, {
        algorithm: 'HS256',
        audience: options.audience ?? 'corvale-admin',
        issuer: options.issuer ?? 'corvale-admin',
        expiresIn: options.expiresIn ?? 600,
    })

export const asObjectId = (value: string | Types.ObjectId): string => value.toString()
