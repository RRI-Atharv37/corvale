import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { authHeader } from './helpers'

/**
 * G0 acceptance spec (TODO.md T0 -> S3, SEC-22, BUG-08, BUG-14).
 *
 * Contract assumed here:
 *   - `User.email` normalizes to lowercase + trimmed on save (schema
 *     `lowercase: true, trim: true`), and every `User.findOne({ email })`
 *     call site normalizes the incoming value the same way before querying,
 *     so `Test@Example.com` and `test@example.com ` are the same account
 *     (BUG-08).
 *   - The minimum password length rises from 8 to 12 characters, applied
 *     identically on register and password-reset confirm.
 *   - `password` is type-checked (`typeof password === 'string'`) before
 *     `.length` is ever read, so a JSON array can no longer smuggle a
 *     passing length check through to Mongoose's implicit cast (BUG-14).
 *   - A password longer than 72 bytes is rejected with a clear validation
 *     error instead of being silently truncated by bcrypt.
 */

const basePassword = 'ValidPassword123!'

describe('Email normalization (BUG-08)', () => {
    it('normalizes email to lowercase on register and returns it normalized', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Case Test', email: 'Test@Example.com', password: basePassword })

        expect(res.status).toBe(201)
        expect(res.body.data.user.email).toBe('test@example.com')
    })

    it('rejects a duplicate registration that only differs by email casing', async () => {
        const app = createApp()
        await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'First', email: 'Dup@Example.com', password: basePassword })

        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Second', email: 'dup@example.com', password: basePassword })

        expect(res.status).toBe(400)
    })

    it('logs in successfully regardless of the casing used at registration', async () => {
        const app = createApp()
        await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Login Case', email: 'MixedCase@Example.com', password: basePassword })

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'mixedcase@example.com', password: basePassword })

        expect(res.status).toBe(200)
    })

    it('trims leading/trailing whitespace from email before storing', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Trim Test', email: '  trim@example.com  ', password: basePassword })

        expect(res.status).toBe(201)
        expect(res.body.data.user.email).toBe('trim@example.com')
    })
})

describe('Password policy (SEC-22)', () => {
    it('rejects a password shorter than 12 characters', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Short Pw', email: 'short-pw@example.com', password: 'Short1!' })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/12/)
    })

    it('accepts a password of exactly 12 characters', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Exact Pw', email: 'exact-pw@example.com', password: 'Exactly12Ch!' })

        expect(res.status).toBe(201)
    })

    it('rejects a password over 72 bytes with a clear error rather than silently truncating', async () => {
        const app = createApp()
        const longPassword = 'Aa1!' + 'x'.repeat(80)
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Long Pw', email: 'long-pw@example.com', password: longPassword })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/72/)
    })

    it('rejects a non-string password (array) rather than letting it pass a length check (BUG-14)', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({
                fullName: 'Array Pw',
                email: 'array-pw@example.com',
                password: ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh'],
            })

        expect(res.status).toBe(400)
    })

    it('applies the same length floor on password-reset confirm', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/password-reset/confirm')
            .send({ token: 'irrelevant-token-value', password: 'tooshort1!' })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/12|invalid|expired/i)
    })

    it('rejects a non-string password on password-reset confirm too', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/password-reset/confirm')
            .send({ token: 'irrelevant-token-value', password: ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh'] })

        expect(res.status).toBe(400)
    })
})

describe('Normalized email flows through the rest of auth (regression guard)', () => {
    it('GET /auth/user still returns the normalized email after login with different casing', async () => {
        const app = createApp()
        await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Flow Test', email: 'FlowTest@Example.com', password: basePassword })

        const login = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'flowtest@example.com', password: basePassword })

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(login.body.data.token))

        expect(res.body.data.email).toBe('flowtest@example.com')
    })
})
