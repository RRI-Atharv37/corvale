import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { registerUser } from './helpers'
import { setMailTransport, sendPasswordResetEmail } from '../utils/mailService'

/**
 * G0 acceptance spec (TODO.md T0 -> S7, "was Phase 14.2").
 *
 * Production password-reset delivery does not exist yet — today
 * `requestPasswordReset` always calls `logPasswordResetLink`, which prints
 * the reset URL to the console (and prints the full URL outside
 * production). Contract assumed for the new `backend/utils/mailService.ts`
 * module:
 *
 *   export interface MailMessage { to: string; subject: string; html: string; text?: string }
 *   export interface MailTransport { sendMail(message: MailMessage): Promise<{ messageId: string }> }
 *   export const setMailTransport(transport: MailTransport | null): void
 *   export const isSmtpConfigured(): boolean            // true iff SMTP_HOST is set
 *   export const sendPasswordResetEmail(email: string, resetUrl: string): Promise<void>
 *
 * `setMailTransport` is the test seam: production wires a real
 * nodemailer transport built from `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
 * `SMTP_PASS` env vars; tests inject a mock implementing `MailTransport`
 * so no real network call is ever made. `authController.requestPasswordReset`
 * must call `sendPasswordResetEmail` when `isSmtpConfigured()` is true, and
 * keep today's `logPasswordResetLink` console fallback when it's false —
 * so a `.env`-less dev environment keeps working exactly as it does now.
 * Either way the HTTP response stays the generic, enumeration-safe message
 * it returns today, and a mail-send failure must not surface as a 500 to
 * the caller (fixing password reset must not create a new probing oracle
 * or a new outage mode).
 */

describe('SMTP password-reset delivery (S7)', () => {
    const originalSmtpHost = process.env.SMTP_HOST

    afterEach(() => {
        process.env.SMTP_HOST = originalSmtpHost
        setMailTransport(null)
        vi.restoreAllMocks()
    })

    it('sends via the configured transport when SMTP_HOST is set, addressed to the requesting user', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'test-message-1' })
        setMailTransport({ sendMail })

        const app = createApp()
        const { email } = await registerUser(app, { email: 'smtp-delivery@example.com' })
        // registerUser also triggers a verification email (added alongside S7, sharing this
        // same mail transport) - clear it so the assertions below isolate the password-reset
        // send under test rather than coupling this spec to registration's mail behavior.
        sendMail.mockClear()

        const res = await request(app)
            .post('/api/v1/auth/password-reset/request')
            .send({ email })

        expect(res.status).toBe(200)
        expect(sendMail).toHaveBeenCalledTimes(1)

        const [message] = sendMail.mock.calls[0]
        expect(message.to).toBe(email)
        expect(message.subject).toMatch(/reset/i)
        expect(message.html).toMatch(/reset-password\?token=/)
    })

    it('falls back to console logging (existing dev behavior) when SMTP_HOST is unset', async () => {
        delete process.env.SMTP_HOST
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'unused' })
        setMailTransport({ sendMail })
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

        const app = createApp()
        const { email } = await registerUser(app, { email: 'smtp-fallback@example.com' })

        const res = await request(app)
            .post('/api/v1/auth/password-reset/request')
            .send({ email })

        expect(res.status).toBe(200)
        expect(sendMail).not.toHaveBeenCalled()
        expect(infoSpy).toHaveBeenCalled()
    })

    it('still returns the generic 200 response even when the mail transport throws', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        const sendMail = vi.fn().mockRejectedValue(new Error('SMTP connection refused'))
        setMailTransport({ sendMail })
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const app = createApp()
        const { email } = await registerUser(app, { email: 'smtp-failure@example.com' })

        const res = await request(app)
            .post('/api/v1/auth/password-reset/request')
            .send({ email })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(errorSpy).toHaveBeenCalled()
    })

    it('does not send (and does not error) for an email with no matching account', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'unused' })
        setMailTransport({ sendMail })

        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/password-reset/request')
            .send({ email: 'no-such-account@example.com' })

        expect(res.status).toBe(200)
        expect(sendMail).not.toHaveBeenCalled()
    })

    it('sendPasswordResetEmail calls the injected transport with the reset link embedded', async () => {
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'direct-1' })
        setMailTransport({ sendMail })

        await sendPasswordResetEmail('direct@example.com', 'http://localhost:5173/reset-password?token=abc123')

        expect(sendMail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'direct@example.com',
                html: expect.stringContaining('http://localhost:5173/reset-password?token=abc123'),
            })
        )
    })
})
