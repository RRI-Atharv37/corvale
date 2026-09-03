import { describe, it, expect, afterEach } from 'vitest'
import { createApp } from '@http/app'
import {
    validateEnv,
    MIN_PRODUCTION_JWT_SECRET_LENGTH,
} from '@infra/config/envValidation'

/**
 * Acceptance spec for rejecting placeholder / weak `JWT_SECRET` at boot (S20, SEC-27).
 *
 * `backend/.env.example` ships a literal `JWT_SECRET=replace-with-a-long-random-string`, and
 * `validateEnv` previously checked only presence. A self-hoster who copies the example file
 * and misses that one line gets a running, healthy-looking service whose access tokens are
 * signed with a value published in the public repo — anyone can then mint a token for an
 * arbitrary `userId` (the default `tokenVersion` is `0`, so a forged `tv: 0` passes too) and
 * read or modify every user's financial data.
 *
 * Contract assumed here (implemented in S20):
 *   - `validateEnv(env)` rejects, at boot and regardless of `NODE_ENV`, a `JWT_SECRET` (or
 *     `OFFLINE_GRANT_PRIVATE_KEY`) still set to a placeholder that ships in the repo or docs,
 *     or to a short list of universally-known weak defaults (case-insensitive).
 *   - When `NODE_ENV=production`, `validateEnv` additionally rejects any `JWT_SECRET` shorter
 *     than `MIN_PRODUCTION_JWT_SECRET_LENGTH` (32) characters.
 *   - Outside production, a short but non-placeholder secret is left alone (dev convenience).
 *   - The thrown error names `JWT_SECRET` so the operator knows which variable to fix.
 *   - `createApp()` surfaces the failure (it calls `validateEnv()` first).
 */

const BASE_ENV: NodeJS.ProcessEnv = {
    MONGO_URI: 'mongodb://127.0.0.1:27017/corvale-test',
    JWT_SECRET: 'a-genuinely-random-unique-secret-value-1234567890',
    JWT_EXPIRY: '15m',
    CLIENT_URL: 'http://localhost:5173',
    OFFLINE_GRANT_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzSWzErj41Bi1saYV\nBmRZPAilchXXmDfafeHmhbasJe2hRANCAASgylw3dpF2vnFfZzMs3IaJfORpfv6k\nHwDfezcdizFaJ1mlp3JTOqQXIfWkYwupdH/BanTSRwqwkh8bl1hH16k6\n-----END PRIVATE KEY-----',
    NODE_ENV: 'production',
}

const envWith = (overrides: Partial<Record<string, string | undefined>>): NodeJS.ProcessEnv => {
    const env = { ...BASE_ENV, ...overrides }
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete env[key]
    }
    return env
}

describe('validateEnv rejects placeholder JWT_SECRET (S20, SEC-27)', () => {
    it('throws on the backend/.env.example placeholder, even outside production', () => {
        expect(() =>
            validateEnv(
                envWith({ JWT_SECRET: 'replace-with-a-long-random-string', NODE_ENV: 'development' })
            )
        ).toThrow(/JWT_SECRET/)
    })

    it('throws on the docs installation-guide placeholder', () => {
        expect(() =>
            validateEnv(envWith({ JWT_SECRET: 'your-secret-key-here' }))
        ).toThrow(/JWT_SECRET/)
    })

    it('matches placeholders case-insensitively and ignoring surrounding whitespace', () => {
        expect(() =>
            validateEnv(envWith({ JWT_SECRET: '  Replace-With-A-Long-Random-String  ' }))
        ).toThrow(/JWT_SECRET/)
    })

    it.each(['changeme', 'change-me', 'secret', 'jwt-secret', 'password'])(
        'throws on the well-known weak value %j',
        (weak) => {
            expect(() => validateEnv(envWith({ JWT_SECRET: weak }))).toThrow(/JWT_SECRET/)
        }
    )

    it('rejects the OFFLINE_GRANT_PRIVATE_KEY placeholder at boot too', () => {
        expect(() =>
            validateEnv(
                envWith({
                    OFFLINE_GRANT_PRIVATE_KEY:
                        'replace-with-your-own-ES256-private-key-pem-newlines-escaped-as-\\n',
                })
            )
        ).toThrow(/OFFLINE_GRANT_PRIVATE_KEY/)
    })
})

describe('validateEnv rejects weak JWT_SECRET in production (S20, SEC-27)', () => {
    it(`throws when JWT_SECRET is shorter than ${MIN_PRODUCTION_JWT_SECRET_LENGTH} chars in production`, () => {
        expect(() =>
            validateEnv(envWith({ JWT_SECRET: 'short-secret', NODE_ENV: 'production' }))
        ).toThrow(/JWT_SECRET/)
    })

    it('allows a short non-placeholder secret outside production', () => {
        expect(() =>
            validateEnv(envWith({ JWT_SECRET: 'short-secret', NODE_ENV: 'development' }))
        ).not.toThrow()
    })

    it('accepts a long unique secret in production', () => {
        expect(() =>
            validateEnv(
                envWith({
                    JWT_SECRET: 'S9f2b1c8e4a7d0f3b6c9e2a5d8f1b4c7e0a3d6f9b2c5e8a1d4',
                    NODE_ENV: 'production',
                })
            )
        ).not.toThrow()
    })

    it(`treats exactly ${MIN_PRODUCTION_JWT_SECRET_LENGTH} chars as acceptable in production`, () => {
        expect(() =>
            validateEnv(envWith({ JWT_SECRET: 'x'.repeat(MIN_PRODUCTION_JWT_SECRET_LENGTH) }))
        ).not.toThrow()
    })
})

describe('createApp surfaces the SEC-27 check', () => {
    const original = process.env.JWT_SECRET

    afterEach(() => {
        process.env.JWT_SECRET = original
    })

    it('refuses to boot when JWT_SECRET is the shipped placeholder', () => {
        process.env.JWT_SECRET = 'replace-with-a-long-random-string'
        expect(() => createApp()).toThrow(/JWT_SECRET/)
    })
})
