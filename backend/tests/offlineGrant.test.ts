import { describe, it, expect, afterEach } from 'vitest'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { createApp } from '@http/app'
import { verifyUserByEmail } from './helpers'
import { generateOfflineGrant, getOfflineGrantDays, OFFLINE_GRANT_ALGORITHM } from "@modules/auth/offlineGrantUtils";

/**
 * Acceptance spec for the server-signed offline session grant (S16, SEC-18).
 *
 * The web client's 30-day "offline session valid until" grant was a plain ISO date string in
 * `localStorage` - a user could extend their own offline access indefinitely by editing it.
 * `generateOfflineGrant(userId)` replaces it with a JWT signed server-side with an EC (ES256)
 * private key (`OFFLINE_GRANT_PRIVATE_KEY`); the client holds only the matching *public* key
 * (`VITE_OFFLINE_GRANT_PUBLIC_KEY`, baked into the build) and can verify the signature offline
 * but never mint or extend a grant itself. `POST /auth/login`, `POST /auth/register`, and
 * `POST /auth/refresh` all return a fresh grant alongside the access token, so the offline
 * window rolls forward on every successful contact with the server exactly like the old
 * `setSessionValidUntil()` call did.
 */

const derivePublicKey = (privateKeyPem: string): string =>
    crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }) as string

describe('generateOfflineGrant (S16, SEC-18)', () => {
    it('signs a JWT verifiable only with the matching public key', () => {
        const grant = generateOfflineGrant('user-123')
        const publicKey = derivePublicKey(process.env.OFFLINE_GRANT_PRIVATE_KEY as string)

        const payload = jwt.verify(grant, publicKey, { algorithms: [OFFLINE_GRANT_ALGORITHM] })

        expect(typeof payload).toBe('object')
        expect((payload as jwt.JwtPayload).sub).toBe('user-123')
    })

    it('rejects a grant verified against a different key pair', () => {
        const grant = generateOfflineGrant('user-123')
        const { publicKey: wrongPublicKey } = crypto.generateKeyPairSync('ec', {
            namedCurve: 'prime256v1',
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        })

        expect(() =>
            jwt.verify(grant, wrongPublicKey, { algorithms: [OFFLINE_GRANT_ALGORITHM] })
        ).toThrow()
    })

    it('expires after the configured OFFLINE_GRANT_DAYS window', () => {
        const publicKey = derivePublicKey(process.env.OFFLINE_GRANT_PRIVATE_KEY as string)
        const grant = generateOfflineGrant('user-123')
        const payload = jwt.verify(grant, publicKey, { algorithms: [OFFLINE_GRANT_ALGORITHM] }) as jwt.JwtPayload

        const days = getOfflineGrantDays()
        const expectedExpiry = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60
        expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
        expect(payload.exp).toBeLessThanOrEqual(expectedExpiry + 5)
        expect(payload.exp).toBeGreaterThanOrEqual(expectedExpiry - 5)
    })

    it('rejects an unsigned/none-alg token even if it carries a valid-looking payload', () => {
        const forged = jwt.sign({ sub: 'attacker' }, '', { algorithm: 'none' })
        const publicKey = derivePublicKey(process.env.OFFLINE_GRANT_PRIVATE_KEY as string)

        expect(() =>
            jwt.verify(forged, publicKey, { algorithms: [OFFLINE_GRANT_ALGORITHM] })
        ).toThrow()
    })

    it('throws when OFFLINE_GRANT_PRIVATE_KEY is not configured', () => {
        const original = process.env.OFFLINE_GRANT_PRIVATE_KEY
        delete process.env.OFFLINE_GRANT_PRIVATE_KEY

        expect(() => generateOfflineGrant('user-123')).toThrow(/OFFLINE_GRANT_PRIVATE_KEY/)

        process.env.OFFLINE_GRANT_PRIVATE_KEY = original
    })
})

describe('validateEnv requires OFFLINE_GRANT_PRIVATE_KEY (S16)', () => {
    afterEach(() => {
        process.env.OFFLINE_GRANT_PRIVATE_KEY =
            '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQglB/23Q45naG26u17\nt4P5XhuS52DGZn7Kg4d/vzNrtr6hRANCAATT6o3PUOrBgfAcmMsjndJSRD6sqpdR\noxQwTUTl0TXsUCkpnUnavDFgIGolZij1LmdVKO8HFdixf8JKj9iDNB4v\n-----END PRIVATE KEY-----'
    })

    it('refuses to boot without OFFLINE_GRANT_PRIVATE_KEY', () => {
        delete process.env.OFFLINE_GRANT_PRIVATE_KEY
        expect(() => createApp()).toThrow(/OFFLINE_GRANT_PRIVATE_KEY/)
    })
})

describe('Auth endpoints return a fresh offline grant (S16, SEC-18)', () => {
    const publicKey = () => derivePublicKey(process.env.OFFLINE_GRANT_PRIVATE_KEY as string)

    it('includes offlineGrant on register, bound to the new user', async () => {
        const app = createApp()
        const res = await request(app).post('/api/v1/auth/register').send({
            acceptedTerms: true,
            ageAttested: true,
            fullName: 'Grant Register',
            email: 'grant-register@example.com',
            password: 'TestPassword123!',
        })

        expect(res.status).toBe(201)
        expect(typeof res.body.data.offlineGrant).toBe('string')
        const payload = jwt.verify(res.body.data.offlineGrant, publicKey(), {
            algorithms: [OFFLINE_GRANT_ALGORITHM],
        }) as jwt.JwtPayload
        expect(payload.sub).toBe(res.body.data.user._id)
    })

    it('includes offlineGrant on login, bound to the logging-in user', async () => {
        const app = createApp()
        const email = 'grant-login@example.com'
        const password = 'TestPassword123!'
        await request(app)
            .post('/api/v1/auth/register')
            .send({ acceptedTerms: true, ageAttested: true, fullName: 'Grant Login', email, password })
        await verifyUserByEmail(email)

        const res = await request(app).post('/api/v1/auth/login').send({ email, password })

        expect(res.status).toBe(200)
        const payload = jwt.verify(res.body.data.offlineGrant, publicKey(), {
            algorithms: [OFFLINE_GRANT_ALGORITHM],
        }) as jwt.JwtPayload
        expect(payload.sub).toBe(res.body.data.user._id)
    })

    it('includes a fresh offlineGrant on refresh', async () => {
        const app = createApp()
        const email = 'grant-refresh@example.com'
        const password = 'TestPassword123!'
        const agent = request.agent(app)
        const registerRes = await agent
            .post('/api/v1/auth/register')
            .send({ acceptedTerms: true, ageAttested: true, fullName: 'Grant Refresh', email, password })

        const refreshRes = await agent.post('/api/v1/auth/refresh')

        expect(refreshRes.status).toBe(200)
        expect(typeof refreshRes.body.data.offlineGrant).toBe('string')
        const payload = jwt.verify(refreshRes.body.data.offlineGrant, publicKey(), {
            algorithms: [OFFLINE_GRANT_ALGORITHM],
        }) as jwt.JwtPayload
        expect(payload.sub).toBe(registerRes.body.data.user._id)
    })
})
