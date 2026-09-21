import { describe, expect, it } from 'vitest'

import { validateEnv } from '../envValidation'

const base: NodeJS.ProcessEnv = {
    MONGO_URI: 'mongodb://localhost/x',
    JWT_SECRET: 'a-unique-user-jwt-secret-of-decent-length',
    JWT_EXPIRY: '15m',
    CLIENT_URL: 'http://localhost:5173',
    OFFLINE_GRANT_PRIVATE_KEY: 'pem',
}

const adminEnv: NodeJS.ProcessEnv = {
    ...base,
    ADMIN_ENABLED: 'true',
    ADMIN_JWT_SECRET: 'a-different-admin-jwt-secret-of-decent-length',
    ADMIN_ORIGIN: 'http://localhost:5180',
    ADMIN_TOTP_ENCRYPTION_KEY: 'ab'.repeat(32),
}

describe('validateEnv - admin surface', () => {
    it('requires nothing admin-related while ADMIN_ENABLED is off', () => {
        expect(() => validateEnv(base)).not.toThrow()
        expect(() => validateEnv({ ...base, ADMIN_ENABLED: 'false' })).not.toThrow()
    })

    it('accepts a complete admin configuration', () => {
        expect(() => validateEnv(adminEnv)).not.toThrow()
    })

    it.each(['ADMIN_JWT_SECRET', 'ADMIN_ORIGIN', 'ADMIN_TOTP_ENCRYPTION_KEY'])('refuses to start without %s', (name) => {
        const env = { ...adminEnv }
        delete env[name]

        expect(() => validateEnv(env)).toThrow(name)
    })

    it('refuses an ADMIN_JWT_SECRET equal to JWT_SECRET', () => {
        expect(() => validateEnv({ ...adminEnv, ADMIN_JWT_SECRET: adminEnv.JWT_SECRET })).toThrow(/ADMIN_JWT_SECRET/)
    })

    it('refuses a short or placeholder ADMIN_JWT_SECRET', () => {
        expect(() => validateEnv({ ...adminEnv, ADMIN_JWT_SECRET: 'too-short' })).toThrow(/ADMIN_JWT_SECRET/)
        expect(() => validateEnv({ ...adminEnv, ADMIN_JWT_SECRET: 'replace-with-a-long-random-string' })).toThrow(
            /ADMIN_JWT_SECRET/
        )
    })

    it('refuses an encryption key that is not 32 bytes', () => {
        expect(() => validateEnv({ ...adminEnv, ADMIN_TOTP_ENCRYPTION_KEY: 'abc123' })).toThrow(/ADMIN_TOTP_ENCRYPTION_KEY/)
    })

    it('refuses an admin origin that is not a bare http(s) origin', () => {
        expect(() => validateEnv({ ...adminEnv, ADMIN_ORIGIN: 'admin.example.com' })).toThrow(/ADMIN_ORIGIN/)
        expect(() => validateEnv({ ...adminEnv, ADMIN_ORIGIN: 'https://admin.example.com/path' })).toThrow(/ADMIN_ORIGIN/)
        expect(() => validateEnv({ ...adminEnv, ADMIN_ORIGIN: '*' })).toThrow(/ADMIN_ORIGIN/)
    })

    it('refuses an admin origin equal to the user app origin', () => {
        expect(() => validateEnv({ ...adminEnv, ADMIN_ORIGIN: 'http://localhost:5173' })).toThrow(/ADMIN_ORIGIN/)
    })

    it('requires at least 32 characters of ADMIN_JWT_SECRET in production too', () => {
        expect(() =>
            validateEnv({ ...adminEnv, NODE_ENV: 'production', ADMIN_JWT_SECRET: 'x'.repeat(31), JWT_SECRET: 'j'.repeat(40) })
        ).toThrow(/ADMIN_JWT_SECRET/)
    })
})
