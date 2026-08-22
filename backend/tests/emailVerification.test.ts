import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { authHeader } from './helpers'
import User from '../models/User'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { setMailTransport } from '../utils/mailService'
import { backfillEmailVerification } from '../utils/backfillEmailVerification'
import { createEmailVerificationForUser } from '../utils/emailVerificationUtils'

/**
 * Email verification (pulled forward from ROADMAP.md's G2-gated L9, built alongside S7
 * since both need the mail-sending module in utils/mailService.ts).
 *
 * Hard-block model: a freshly-registered user can still log in, but every route behind the
 * `protect` middleware (everything except a small allowlist on `authenticateOnly`) rejects
 * them with 403 EMAIL_NOT_VERIFIED until they confirm the emailed token. Existing accounts
 * are grandfathered in via `backfillEmailVerification` so only post-deploy signups verify.
 */
describe('Email verification', () => {
    const originalSmtpHost = process.env.SMTP_HOST

    afterEach(() => {
        process.env.SMTP_HOST = originalSmtpHost
        setMailTransport(null)
        vi.restoreAllMocks()
    })

    const registerRaw = async (app: ReturnType<typeof createApp>, email: string) => {
        const res = await request(app).post('/api/v1/auth/register').send({
            fullName: 'Unverified User',
            email,
            password: 'TestPassword123!',
        })
        return { token: res.body.data.token as string, user: res.body.data.user }
    }

    it('sends a verification email on register when SMTP is configured, and the new user starts unverified', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'verify-1' })
        setMailTransport({ sendMail })

        const app = createApp()
        const { user } = await registerRaw(app, 'verify-smtp@example.com')

        expect(user.isEmailVerified).toBe(false)
        expect(sendMail).toHaveBeenCalledTimes(1)

        const [message] = sendMail.mock.calls[0]
        expect(message.to).toBe('verify-smtp@example.com')
        expect(message.subject).toMatch(/verify/i)
        expect(message.html).toMatch(/verify-email\?token=/)
    })

    it('falls back to console logging when SMTP_HOST is unset', async () => {
        delete process.env.SMTP_HOST
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'unused' })
        setMailTransport({ sendMail })
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

        const app = createApp()
        await registerRaw(app, 'verify-fallback@example.com')

        expect(sendMail).not.toHaveBeenCalled()
        expect(infoSpy).toHaveBeenCalled()
    })

    it('blocks an unverified user from an ordinary protected route with 403 EMAIL_NOT_VERIFIED', async () => {
        const app = createApp()
        const { token } = await registerRaw(app, 'verify-blocked@example.com')

        const res = await request(app).get('/api/v1/accounts').set(authHeader(token))

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.EMAIL_NOT_VERIFIED)
    })

    it('still allows an unverified user to check their own profile and log out everywhere', async () => {
        const app = createApp()
        const { token } = await registerRaw(app, 'verify-exempt@example.com')

        const userRes = await request(app).get('/api/v1/auth/user').set(authHeader(token))
        expect(userRes.status).toBe(200)
        expect(userRes.body.data.isEmailVerified).toBe(false)

        const logoutAllRes = await request(app).post('/api/v1/auth/logout-all').set(authHeader(token))
        expect(logoutAllRes.status).toBe(200)
    })

    it('confirms verification with the emailed token and unblocks protected routes', async () => {
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'verify-2' })
        setMailTransport({ sendMail })
        process.env.SMTP_HOST = 'smtp.test.local'

        const app = createApp()
        const { token } = await registerRaw(app, 'verify-confirm@example.com')

        const [message] = sendMail.mock.calls[0]
        const rawToken = /token=([a-f0-9]+)/.exec(message.html)?.[1]
        expect(rawToken).toBeTruthy()

        const confirmRes = await request(app)
            .post('/api/v1/auth/email-verification/confirm')
            .send({ token: rawToken })

        expect(confirmRes.status).toBe(200)

        const user = await User.findOne({ email: 'verify-confirm@example.com' })
        expect(user?.isEmailVerified).toBe(true)
        expect(user?.emailVerificationTokenHash).toBeUndefined()

        const accountsRes = await request(app).get('/api/v1/accounts').set(authHeader(token))
        expect(accountsRes.status).toBe(200)
    })

    it('rejects an invalid verification token', async () => {
        const app = createApp()

        const res = await request(app)
            .post('/api/v1/auth/email-verification/confirm')
            .send({ token: 'not-a-real-token' })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_INVALID)
    })

    it('rejects an expired verification token', async () => {
        const app = createApp()
        const email = 'verify-expired@example.com'
        const { token } = await registerRaw(app, email)

        const userDoc = await User.findOne({ email })
        const rawToken = await createEmailVerificationForUser(userDoc!)
        await User.findOneAndUpdate({ email }, { emailVerificationExpires: new Date(Date.now() - 60_000) })

        const res = await request(app)
            .post('/api/v1/auth/email-verification/confirm')
            .send({ token: rawToken })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_INVALID)

        // The account itself remains unverified and still blocked.
        const stillBlockedRes = await request(app).get('/api/v1/accounts').set(authHeader(token))
        expect(stillBlockedRes.status).toBe(403)
    })

    it('resend issues a fresh token and email for an unverified, authenticated user', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'resend-1' })
        setMailTransport({ sendMail })

        const app = createApp()
        const { token } = await registerRaw(app, 'verify-resend@example.com')
        expect(sendMail).toHaveBeenCalledTimes(1)

        const resendRes = await request(app)
            .post('/api/v1/auth/email-verification/resend')
            .set(authHeader(token))

        expect(resendRes.status).toBe(200)
        expect(sendMail).toHaveBeenCalledTimes(2)
    })

    it('resend for an already-verified user is a no-op that does not send another email', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'resend-2' })
        setMailTransport({ sendMail })

        const app = createApp()
        const { token, user } = await registerRaw(app, 'verify-already@example.com')
        await User.findByIdAndUpdate(user._id, { isEmailVerified: true })
        sendMail.mockClear()

        const resendRes = await request(app)
            .post('/api/v1/auth/email-verification/resend')
            .set(authHeader(token))

        expect(resendRes.status).toBe(200)
        expect(resendRes.body.data.message).toBe(ERROR_MESSAGES.AUTH.EMAIL_ALREADY_VERIFIED)
        expect(sendMail).not.toHaveBeenCalled()
    })

    it('backfill marks pre-existing accounts verified without touching new unverified ones', async () => {
        const app = createApp()

        // Simulate a pre-existing account from before this feature shipped: created directly,
        // with no isEmailVerified field at all (mirrors documents already in the database).
        await User.collection.insertOne({
            fullName: 'Legacy User',
            email: 'legacy@example.com',
            password: 'hashed-not-relevant-here',
            tokenVersion: 0,
        })

        const { user: newUser } = await registerRaw(app, 'verify-post-deploy@example.com')

        const dryRunResult = await backfillEmailVerification({ dryRun: true })
        expect(dryRunResult.matched).toBe(1)
        expect(dryRunResult.modified).toBe(0)

        const legacyStillUnset = await User.findOne({ email: 'legacy@example.com' }).lean()
        expect(legacyStillUnset?.isEmailVerified).toBeUndefined()

        const applyResult = await backfillEmailVerification({ dryRun: false })
        expect(applyResult.matched).toBe(1)
        expect(applyResult.modified).toBe(1)

        const legacyUser = await User.findOne({ email: 'legacy@example.com' })
        expect(legacyUser?.isEmailVerified).toBe(true)

        const stillUnverifiedNewUser = await User.findById(newUser._id)
        expect(stillUnverifiedNewUser?.isEmailVerified).toBe(false)
    })
})
