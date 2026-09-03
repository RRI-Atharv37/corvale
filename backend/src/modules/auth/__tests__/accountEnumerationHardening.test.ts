import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { createApp } from '@http/app'
import { User } from '@modules/users'
import { authHeader, registerUser } from '@tests/helpers'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

/**
 * Acceptance spec for the account-enumeration hardening in Sprint S25 (SEC-32).
 *
 * Three endpoints disclosed whether an email address has a Corvale account:
 *
 *   1. POST /workspaces/:workspaceId/members — looked the invitee up by email and 404'd
 *      (`WORKSPACE.USER_NOT_FOUND`) when there was no match, metered only by the global
 *      300/15min mutating limiter (~28,800 probes/day). Fix: its own tight limiter
 *      (`createWorkspaceInviteRateLimiter`, env `WORKSPACE_INVITE_RATE_LIMIT_MAX` /
 *      `WORKSPACE_INVITE_RATE_LIMIT_WINDOW_MS`, default 30 / 15 min), separate budget from
 *      login so a probing burst can't lock a real user out.
 *   2. POST /auth/register — still returns `USER.USER_ALREADY_EXISTS` for a taken address.
 *      Making it enumeration-safe means suppressing that signal and disclosing the collision
 *      only by email, which breaks the auto-session / in-app verify-screen signup flow (V9).
 *      For v1.0.0 the accepted mitigation is the pre-existing dedicated `auth-register`
 *      limiter; this spec pins that the duplicate response is deliberate and that a register
 *      burst does not consume the login budget.
 *   3. POST /auth/login — returned before `comparePassword` when the user was not found, so a
 *      bcrypt-cost-12 hash ran only for real accounts (a measurable timing oracle). Fix:
 *      always run a bcrypt comparison against a fixed dummy hash when the user is missing.
 */

describe('Account enumeration hardening (S25 / SEC-32)', () => {
    describe('POST /auth/login — constant-time regardless of whether the account exists', () => {
        it('returns the same 400 INVALID_CREDENTIALS for an unknown email and a wrong password', async () => {
            const app = createApp()
            await registerUser(app, { email: 'login-oracle@example.com', password: 'RightPassword123!' })

            const unknownEmail = await request(app)
                .post('/api/v1/auth/login')
                .send({ email: 'not-a-user@example.com', password: 'whatever-123' })

            const wrongPassword = await request(app)
                .post('/api/v1/auth/login')
                .send({ email: 'login-oracle@example.com', password: 'WrongPassword123!' })

            expect(unknownEmail.status).toBe(400)
            expect(wrongPassword.status).toBe(400)
            expect(unknownEmail.body.message).toBe(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS)
            expect(wrongPassword.body.message).toBe(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS)
        })

        it('still runs a bcrypt comparison when no user matches the email (no early return)', async () => {
            const app = createApp()
            const compareSpy = vi.spyOn(bcrypt, 'compare')

            try {
                await request(app)
                    .post('/api/v1/auth/login')
                    .send({ email: 'definitely-nobody@example.com', password: 'some-password-123' })

                expect(compareSpy).toHaveBeenCalled()
            } finally {
                compareSpy.mockRestore()
            }
        })
    })

    describe('POST /workspaces/:workspaceId/members — dedicated invite rate limiter', () => {
        const originalMax = process.env.WORKSPACE_INVITE_RATE_LIMIT_MAX
        const originalWindow = process.env.WORKSPACE_INVITE_RATE_LIMIT_WINDOW_MS

        beforeAll(() => {
            process.env.WORKSPACE_INVITE_RATE_LIMIT_MAX = '3'
            process.env.WORKSPACE_INVITE_RATE_LIMIT_WINDOW_MS = '600000'
        })

        afterAll(() => {
            process.env.WORKSPACE_INVITE_RATE_LIMIT_MAX = originalMax
            process.env.WORKSPACE_INVITE_RATE_LIMIT_WINDOW_MS = originalWindow
        })

        it('429s email probing through the invite endpoint after its own max is exceeded', async () => {
            const app = createApp()
            const owner = await registerUser(app, { email: 'invite-limiter-owner@example.com' })
            const wsRes = await request(app)
                .post('/api/v1/workspaces')
                .set(authHeader(owner.token))
                .send({ name: 'Probe Target' })
            const workspaceId = wsRes.body.data._id

            const statuses: number[] = []
            for (let i = 0; i < 5; i++) {
                const res = await request(app)
                    .post(`/api/v1/workspaces/${workspaceId}/members`)
                    .set(authHeader(owner.token))
                    .send({ email: `probe-${i}@example.com`, role: 'viewer' })
                statuses.push(res.status)
            }

            // First 3 are 404 (no such user — the oracle), then the limiter takes over.
            expect(statuses.slice(0, 3)).toEqual([404, 404, 404])
            expect(statuses).toContain(429)
        })

        it('an invite-probing burst does not consume the login rate-limit budget', async () => {
            const app = createApp()
            const owner = await registerUser(app, { email: 'invite-vs-login@example.com' })
            const wsRes = await request(app)
                .post('/api/v1/workspaces')
                .set(authHeader(owner.token))
                .send({ name: 'Isolation Check' })
            const workspaceId = wsRes.body.data._id

            for (let i = 0; i < 5; i++) {
                await request(app)
                    .post(`/api/v1/workspaces/${workspaceId}/members`)
                    .set(authHeader(owner.token))
                    .send({ email: `burst-${i}@example.com`, role: 'viewer' })
            }

            const login = await request(app)
                .post('/api/v1/auth/login')
                .send({ email: 'invite-vs-login@example.com', password: 'nope-wrong-123' })

            expect(login.status).not.toBe(429)
        })
    })

    describe('POST /auth/register — duplicate signal is deliberate, budget is isolated', () => {
        it('still reports USER_ALREADY_EXISTS for a taken address (accepted residual risk, V9 UX)', async () => {
            const app = createApp()
            await registerUser(app, { email: 'taken@example.com' })

            const res = await request(app).post('/api/v1/auth/register').send({
                acceptedTerms: true,
                ageAttested: true,
                fullName: 'Second Attempt',
                email: 'taken@example.com',
                password: 'ValidPassword123!',
            })

            expect(res.status).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.USER.USER_ALREADY_EXISTS)
        })

        it('a burst of duplicate registrations does not lock a legitimate user out of login', async () => {
            const originalMax = process.env.AUTH_RATE_LIMIT_MAX
            process.env.AUTH_RATE_LIMIT_MAX = '3'
            try {
                const app = createApp()
                await registerUser(app, { email: 'reg-burst@example.com', password: 'RightPassword123!' })

                for (let i = 0; i < 6; i++) {
                    await request(app).post('/api/v1/auth/register').send({
                        acceptedTerms: true,
                        ageAttested: true,
                        fullName: 'Dup',
                        email: 'reg-burst@example.com',
                        password: 'ValidPassword123!',
                    })
                }

                const login = await request(app)
                    .post('/api/v1/auth/login')
                    .send({ email: 'reg-burst@example.com', password: 'RightPassword123!' })

                expect(login.status).toBe(200)
            } finally {
                process.env.AUTH_RATE_LIMIT_MAX = originalMax
            }
        })
    })

    describe('Unverified accounts expire so a squatted address is released (SEC-32)', () => {
        it('declares a TTL index that only covers unverified accounts', () => {
            const ttlIndexes = User.schema
                .indexes()
                .filter(([, options]) => typeof options?.expireAfterSeconds === 'number')

            expect(ttlIndexes.length).toBeGreaterThan(0)

            const unverifiedTtl = ttlIndexes.find(
                ([, options]) =>
                    options?.partialFilterExpression &&
                    options.partialFilterExpression.isEmailVerified === false
            )
            expect(unverifiedTtl).toBeDefined()
            // A real user gets a meaningful grace window, not minutes.
            expect(unverifiedTtl![1].expireAfterSeconds).toBeGreaterThanOrEqual(24 * 60 * 60)
        })

        it('a verified account does not match the partial filter (never TTL-eligible)', async () => {
            const app = createApp()
            const { userId } = await registerUser(app, { email: 'stays-put@example.com' })

            const user = await User.findById(userId)
            expect(user?.isEmailVerified).toBe(true)
        })
    })
})
