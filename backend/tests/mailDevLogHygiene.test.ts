import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '@http/app'
import { registerUser } from './helpers'
import { redactUrlToken, isMailDevLogEnabled } from '@infra/mail/mailDevLog'
import { logPasswordResetLink } from "@modules/auth/passwordResetUtils";
import { logEmailVerificationLink } from "@modules/auth/emailVerificationUtils";

/**
 * Acceptance spec for SEC-69 (S34): password-reset and email-verification URLs — which carry a
 * raw account-takeover token — must never be logged unless an operator explicitly opts in with
 * `MAIL_DEV_LOG=true`, and the token must be redacted from the logged URL regardless.
 *
 * Before S34 the guard was `NODE_ENV !== 'production'`, and `.env.example` ships
 * `NODE_ENV=development` — so any deployment that forgot to set `NODE_ENV` logged working
 * takeover tokens straight into the container log driver. Fail-open by default.
 */

const TOKEN_RE = /[0-9a-f]{64}/i

describe('redactUrlToken (SEC-69, S34)', () => {
    it('replaces the token query param with a placeholder', () => {
        const url = 'https://corvale.app/reset-password?token=' + 'a'.repeat(64)
        const out = redactUrlToken(url)
        expect(out).not.toMatch(TOKEN_RE)
        expect(out).toContain('https://corvale.app/reset-password?token=')
        expect(out).toMatch(/redacted/i)
    })

    it('redacts the verify-email token param too', () => {
        const url = 'https://corvale.app/verify-email?token=' + 'b'.repeat(64)
        expect(redactUrlToken(url)).not.toMatch(TOKEN_RE)
    })

    it('leaves a URL with no token param untouched', () => {
        const url = 'https://corvale.app/verify-email'
        expect(redactUrlToken(url)).toBe(url)
    })
})

describe('isMailDevLogEnabled (SEC-69, S34)', () => {
    const original = process.env.MAIL_DEV_LOG
    afterEach(() => {
        if (original === undefined) delete process.env.MAIL_DEV_LOG
        else process.env.MAIL_DEV_LOG = original
    })

    it('is false when unset (fail-closed)', () => {
        delete process.env.MAIL_DEV_LOG
        expect(isMailDevLogEnabled()).toBe(false)
    })

    it('is false for any value other than the literal "true"', () => {
        process.env.MAIL_DEV_LOG = 'development'
        expect(isMailDevLogEnabled()).toBe(false)
        process.env.MAIL_DEV_LOG = '1'
        expect(isMailDevLogEnabled()).toBe(false)
    })

    it('is true only for the literal "true"', () => {
        process.env.MAIL_DEV_LOG = 'true'
        expect(isMailDevLogEnabled()).toBe(true)
    })
})

describe('logPasswordResetLink / logEmailVerificationLink (SEC-69, S34)', () => {
    const originalDevLog = process.env.MAIL_DEV_LOG
    const originalNodeEnv = process.env.NODE_ENV

    afterEach(() => {
        if (originalDevLog === undefined) delete process.env.MAIL_DEV_LOG
        else process.env.MAIL_DEV_LOG = originalDevLog
        process.env.NODE_ENV = originalNodeEnv
        vi.restoreAllMocks()
    })

    const rawUrl = 'https://corvale.app/reset-password?token=' + 'c'.repeat(64)

    it('never prints the raw token, even with MAIL_DEV_LOG=true', () => {
        process.env.MAIL_DEV_LOG = 'true'
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

        logPasswordResetLink('user@example.com', rawUrl)
        logEmailVerificationLink('user@example.com', rawUrl.replace('reset-password', 'verify-email'))

        const printed = infoSpy.mock.calls.flat().join('\n')
        expect(printed).not.toMatch(TOKEN_RE)
    })

    it('does not print the URL at all when MAIL_DEV_LOG is unset', () => {
        delete process.env.MAIL_DEV_LOG
        process.env.NODE_ENV = 'development'
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

        logPasswordResetLink('user@example.com', rawUrl)

        const printed = infoSpy.mock.calls.flat().join('\n')
        expect(printed).not.toContain('reset-password?token=')
        expect(printed).not.toMatch(TOKEN_RE)
        // an acknowledgement line (no secret) is still fine
        expect(printed).toMatch(/user@example\.com/)
    })

    it('prints the redacted URL when MAIL_DEV_LOG=true', () => {
        process.env.MAIL_DEV_LOG = 'true'
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

        logPasswordResetLink('user@example.com', rawUrl)

        const printed = infoSpy.mock.calls.flat().join('\n')
        expect(printed).toContain('reset-password?token=')
        expect(printed).toMatch(/redacted/i)
        expect(printed).not.toMatch(TOKEN_RE)
    })
})

describe('POST /auth/password-reset/request — no token in logs (SEC-69, S34)', () => {
    const originalDevLog = process.env.MAIL_DEV_LOG
    const originalSmtpHost = process.env.SMTP_HOST

    afterEach(() => {
        if (originalDevLog === undefined) delete process.env.MAIL_DEV_LOG
        else process.env.MAIL_DEV_LOG = originalDevLog
        if (originalSmtpHost === undefined) delete process.env.SMTP_HOST
        else process.env.SMTP_HOST = originalSmtpHost
        vi.restoreAllMocks()
    })

    it('does not emit the reset token to the console on the dev fallback path', async () => {
        delete process.env.SMTP_HOST
        delete process.env.MAIL_DEV_LOG
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

        const app = createApp()
        const { email } = await registerUser(app, { email: 'sec69-reset@example.com' })

        const res = await request(app)
            .post('/api/v1/auth/password-reset/request')
            .send({ email })

        expect(res.status).toBe(200)
        const printed = infoSpy.mock.calls.flat().join('\n')
        expect(printed).not.toMatch(TOKEN_RE)
    })
})
