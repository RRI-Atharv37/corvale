import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { registerUser } from './helpers'

/**
 * G0 acceptance spec (TODO.md S2, SEC-09).
 *
 * Contract assumed here:
 *   - A global body-sanitization middleware rejects (400, not silent-strip) any
 *     JSON request body containing a key that starts with `$` or contains `.`,
 *     at any depth (object or array), before the body reaches a controller.
 *   - This closes the NoSQL operator-injection route through
 *     `User.findOne({ email })` in register, login, and password-reset request
 *     (and any other controller that spreads body values into a Mongoose filter),
 *     without needing per-controller sanitization.
 *   - A well-formed request body is unaffected.
 */

describe('NoSQL operator injection — body sanitization (SEC-09)', () => {
    it('rejects a login body using a $gt operator instead of a real email', async () => {
        const app = createApp()
        await registerUser(app, { email: 'victim@example.com' })

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: { $gt: '' }, password: 'irrelevant' })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
    })

    it('rejects a register body with an operator key on email', async () => {
        const app = createApp()

        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Attacker', email: { $ne: null }, password: 'ValidPassword123!' })

        expect(res.status).toBe(400)
    })

    it('rejects a password-reset request body with an operator key', async () => {
        const app = createApp()

        const res = await request(app)
            .post('/api/v1/auth/password-reset/request')
            .send({ email: { $regex: '.*' } })

        expect(res.status).toBe(400)
    })

    it('rejects an operator key nested inside an array', async () => {
        const app = createApp()
        const { token } = await registerUser(app, { email: 'nested-array@example.com' })

        const res = await request(app)
            .post('/api/v1/transactions')
            .set({ Authorization: `Bearer ${token}` })
            .send({ tags: [{ $where: 'sleep(1000)' }] })

        expect(res.status).toBe(400)
    })

    it('rejects a key containing a dot, not only a leading dollar sign', async () => {
        const app = createApp()

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'someone@example.com', 'password.$ne': null })

        expect(res.status).toBe(400)
    })

    it('does not reject an ordinary, well-formed request body', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ fullName: 'Normal User', email: 'normal-user@example.com', password: 'ValidPassword123!' })

        expect(res.status).toBe(201)
    })
})
