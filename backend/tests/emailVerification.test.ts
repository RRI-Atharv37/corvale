import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '@http/app'
import { authHeader } from './helpers'
import { User } from '@modules/users'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { setMailTransport } from '@infra/mail/mailService'
import { backfillEmailVerification } from '../utils/backfillEmailVerification'
import { createEmailVerificationForUser } from "@modules/auth/emailVerificationUtils";

/**
 * Email verification (pulled forward from L9's G2 scope, built alongside S7 since both need
 * the mail-sending module in utils/mailService.ts).
 *
 * Hard-block model (V9): `POST /auth/login` itself refuses an unverified account with 403
 * EMAIL_NOT_VERIFIED, and every route behind the `protect` middleware (everything except a
 * small allowlist on `authenticateOnly`) does the same. Registration still auto-issues a
 * session so a brand-new signup lands on the in-app verify screen; a returning unverified user
 * who is blocked at login can request a fresh link via the unauthenticated `{ email }` form of
 * `POST /auth/email-verification/resend`, which stays enumeration-safe. Existing accounts are
 * grandfathered in via `backfillEmailVerification` so only post-deploy signups verify.
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
            acceptedTerms: true,
            ageAttested: true,
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

    it('refuses login for an unverified account with 403 EMAIL_NOT_VERIFIED and issues no session', async () => {
        const app = createApp()
        await registerRaw(app, 'verify-login-blocked@example.com')

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'verify-login-blocked@example.com', password: 'TestPassword123!' })

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.EMAIL_NOT_VERIFIED)
        expect(res.body.data?.token).toBeUndefined()
        expect(res.headers['set-cookie']).toBeUndefined()
    })

    it('allows login once the account is verified', async () => {
        const app = createApp()
        await registerRaw(app, 'verify-login-ok@example.com')
        await User.updateOne(
            { email: 'verify-login-ok@example.com' },
            { $set: { isEmailVerified: true } }
        )

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'verify-login-ok@example.com', password: 'TestPassword123!' })

        expect(res.status).toBe(200)
        expect(res.body.data.token).toBeTruthy()
    })

    it('resends a fresh link for an unauthenticated request carrying a valid unverified email', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'resend-public-1' })
        setMailTransport({ sendMail })

        const app = createApp()
        await registerRaw(app, 'verify-public-resend@example.com')
        sendMail.mockClear()

        const res = await request(app)
            .post('/api/v1/auth/email-verification/resend')
            .send({ email: 'verify-public-resend@example.com' })

        expect(res.status).toBe(200)
        expect(res.body.data.message).toBe(ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_SENT)
        expect(sendMail).toHaveBeenCalledTimes(1)
    })

    it('unauthenticated resend is enumeration-safe: unknown and already-verified emails get the same generic 200 with no send', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        const sendMail = vi.fn().mockResolvedValue({ messageId: 'resend-public-2' })
        setMailTransport({ sendMail })

        const app = createApp()
        await registerRaw(app, 'verify-public-verified@example.com')
        await User.updateOne(
            { email: 'verify-public-verified@example.com' },
            { $set: { isEmailVerified: true } }
        )
        sendMail.mockClear()

        const unknown = await request(app)
            .post('/api/v1/auth/email-verification/resend')
            .send({ email: 'nobody-at-all@example.com' })
        const alreadyVerified = await request(app)
            .post('/api/v1/auth/email-verification/resend')
            .send({ email: 'verify-public-verified@example.com' })

        expect(unknown.status).toBe(200)
        expect(unknown.body.data.message).toBe(ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_SENT)
        expect(alreadyVerified.status).toBe(200)
        expect(alreadyVerified.body.data.message).toBe(ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_SENT)
        expect(sendMail).not.toHaveBeenCalled()
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
