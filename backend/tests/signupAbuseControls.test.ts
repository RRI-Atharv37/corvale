import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import User from '../models/User'
import { setCaptchaVerifier } from '../utils/captchaService'

/**
 * Acceptance spec for signup abuse controls (L9 second half).
 *
 * L9's email-verification core (register hard-blocks unverified accounts via `protect`) was
 * pulled forward and shipped alongside S7 — see `emailVerification.test.ts`. What remains open
 * for G2 is abuse control on *open* registration: today `POST /auth/register` shares its
 * `createAuthRateLimiter()` instance with `POST /auth/login` (`routes/authRoutes.ts:21,34-35`),
 * so the two count against the same per-IP budget, and there is no CAPTCHA or any other check
 * that a registration was made by a human. IP-based limits alone are trivially bypassed by
 * rotating proxies for the specific risk here — bulk automated account creation — so the
 * recommended second control is CAPTCHA verification, gated off by default like every other
 * env-driven seam in this codebase (ClamAV, Sentry, SMTP).
 *
 * Contract assumed here, mirroring `mailService.ts`'s injectable-transport seam
 * (`setMailTransport`) that `smtpDelivery.test.ts` already pins:
 *
 *   backend/utils/captchaService.ts:
 *     export interface CaptchaVerifier { verify(token: string): Promise<boolean> }
 *     export const setCaptchaVerifier(verifier: CaptchaVerifier | null): void   // test seam
 *     export const isCaptchaEnabled(): boolean   // true iff CAPTCHA_ENABLED === 'true'
 *     export const verifyCaptcha(token: string | undefined): Promise<boolean>
 *       // Always resolves true when !isCaptchaEnabled() (today's behavior, byte-for-byte).
 *       // When enabled: false for a missing/empty token; otherwise delegates to the injected
 *       // verifier (production builds one from a provider SDK via `CAPTCHA_SECRET_KEY`).
 *
 *   `registerUser` (`controllers/authController.ts`) calls `verifyCaptcha(req.body.captchaToken)`
 *   before `User.create(...)` and throws a new `ERROR_MESSAGES.AUTH.CAPTCHA_FAILED` (400) if it
 *   resolves false — no account, no email sent.
 *
 *   `routes/authRoutes.ts` gains its own `registerRateLimiter = createAuthRateLimiter()`
 *   instance for `POST /register`, separate from `authRateLimiter` (which stays on `/login`
 *   alone) — the same "own instance so one route's abuse budget can't lock out another" pattern
 *   already used for `sessionRateLimiter`/`passwordResetRateLimiter`/`verificationRateLimiter`.
 */

describe('Signup abuse controls (L9)', () => {
    afterEach(() => {
        delete process.env.CAPTCHA_ENABLED
    })

    describe('CAPTCHA gate', () => {
        it('registration succeeds with no captchaToken when CAPTCHA_ENABLED is unset (regression)', async () => {
            const app = createApp()

            const res = await request(app).post('/api/v1/auth/register').send({
                acceptedTerms: true,
                ageAttested: true,
                fullName: 'No Captcha Needed',
                email: 'no-captcha@example.com',
                password: 'ValidPassword123!',
            })

            expect(res.status).toBe(201)
        })

        it('rejects registration with a missing captchaToken when CAPTCHA_ENABLED=true', async () => {
            process.env.CAPTCHA_ENABLED = 'true'
            const app = createApp()

            const res = await request(app).post('/api/v1/auth/register').send({
                acceptedTerms: true,
                ageAttested: true,
                fullName: 'Bot',
                email: 'bot-no-token@example.com',
                password: 'ValidPassword123!',
            })

            expect(res.status).toBe(400)
            expect(res.body.success).toBe(false)

            const created = await User.findOne({ email: 'bot-no-token@example.com' })
            expect(created).toBeNull()
        })

        it('rejects registration when the injected verifier reports the token invalid', async () => {
            process.env.CAPTCHA_ENABLED = 'true'
            setCaptchaVerifier({ verify: async () => false })
            const app = createApp()

            try {
                const res = await request(app).post('/api/v1/auth/register').send({
                    acceptedTerms: true,
                    ageAttested: true,
                    fullName: 'Bot',
                    email: 'bot-bad-token@example.com',
                    password: 'ValidPassword123!',
                    captchaToken: 'invalid-token',
                })

                expect(res.status).toBe(400)
                const created = await User.findOne({ email: 'bot-bad-token@example.com' })
                expect(created).toBeNull()
            } finally {
                setCaptchaVerifier(null)
            }
        })

        it('accepts registration when the injected verifier reports the token valid', async () => {
            process.env.CAPTCHA_ENABLED = 'true'
            setCaptchaVerifier({ verify: async (token: string) => token === 'good-token' })
            const app = createApp()

            try {
                const res = await request(app).post('/api/v1/auth/register').send({
                    acceptedTerms: true,
                    ageAttested: true,
                    fullName: 'Real Human',
                    email: 'real-human@example.com',
                    password: 'ValidPassword123!',
                    captchaToken: 'good-token',
                })

                expect(res.status).toBe(201)
            } finally {
                setCaptchaVerifier(null)
            }
        })
    })

    describe('Registration has its own rate-limit budget, separate from login', () => {
        beforeAll(() => {
            process.env.AUTH_RATE_LIMIT_MAX = '3'
            process.env.AUTH_RATE_LIMIT_WINDOW_MS = '600000'
        })

        it('a burst of failed logins does not consume registration\'s rate-limit budget', async () => {
            const app = createApp()

            for (let i = 0; i < 5; i++) {
                await request(app)
                    .post('/api/v1/auth/login')
                    .send({ email: 'nobody@example.com', password: 'wrong-password' })
            }

            const res = await request(app).post('/api/v1/auth/register').send({
                acceptedTerms: true,
                ageAttested: true,
                fullName: 'Fresh Signup',
                email: 'fresh-signup-after-login-burst@example.com',
                password: 'ValidPassword123!',
            })

            expect(res.status).toBe(201)
        })
    })
})
