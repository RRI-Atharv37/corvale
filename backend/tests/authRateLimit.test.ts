import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { authHeader, registerUser } from './helpers'
import { ERROR_MESSAGES } from '../utils/errorMessages'

describe('Auth rate limiting', () => {
    beforeAll(() => {
        process.env.AUTH_RATE_LIMIT_MAX = '3'
        process.env.AUTH_RATE_LIMIT_WINDOW_MS = '600000'
    })

    it('rate limits POST /auth/login after max attempts', async () => {
        const app = createApp()

        for (let i = 0; i < 3; i++) {
            const res = await request(app)
                .post('/api/v1/auth/login')
                .send({ email: 'ratelimit-login@example.com', password: 'wrong-password' })

            expect(res.status).toBe(400)
        }

        const blocked = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'ratelimit-login@example.com', password: 'wrong-password' })

        expect(blocked.status).toBe(429)
        expect(blocked.body.success).toBe(false)
        expect(blocked.body.message).toBe(ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS)
    })

    it('rate limits POST /auth/register after max attempts', async () => {
        const registerApp = createApp()

        for (let i = 0; i < 3; i++) {
            const res = await request(registerApp)
                .post('/api/v1/auth/register')
                .send({
                    acceptedTerms: true,
                    ageAttested: true,
                    fullName: 'Rate Limit User',
                    email: `ratelimit-reg-${i}@example.com`,
                    password: 'short',
                })

            expect([400, 201]).toContain(res.status)
        }

        const blocked = await request(registerApp)
            .post('/api/v1/auth/register')
            .send({
                acceptedTerms: true,
                ageAttested: true,
                fullName: 'Blocked User',
                email: 'blocked@example.com',
                password: 'ValidPassword123!',
            })

        expect(blocked.status).toBe(429)
        expect(blocked.body.success).toBe(false)
        expect(blocked.body.message).toBe(ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS)
    })

    it('does not rate limit GET /auth/user', async () => {
        const userApp = createApp()
        const { token } = await registerUser(userApp)

        for (let i = 0; i < 5; i++) {
            const res = await request(userApp)
                .get('/api/v1/auth/user')
                .set(authHeader(token))

            expect(res.status).toBe(200)
        }
    })
})
