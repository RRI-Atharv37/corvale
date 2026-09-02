import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { User } from '@modules/users'
import { authHeader, registerUser } from './helpers'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { PRIVACY_VERSION, TERMS_VERSION } from "@modules/users/legalVersions";

/**
 * Acceptance spec for the consent record and 18+ attestation (M0c / M0c2).
 *
 * The published privacy policy and ToS assert two things the codebase could not previously
 * prove: that a user agreed to the terms, and that they are 18 or older. India's DPDP Act 2023
 * treats anyone under 18 as a child requiring verifiable parental consent - not practically
 * implementable by a solo operator - so the position is 18+ only, attested at signup.
 *
 * Contract pinned here:
 *
 *   Registration requires `acceptedTerms: true` and `ageAttested: true` in the body. Either one
 *   missing or falsy is a 400 and creates no user.
 *
 *   The *server* stamps the version numbers from `utils/legalVersions.ts`. The client never
 *   asserts which version it agreed to - a client-supplied version is ignored, not trusted. This
 *   removes drift between the two workspaces and makes the stored record evidence rather than
 *   hearsay.
 *
 *   `legalAcceptance` is optional on the schema with no default, so an absent value means
 *   "has never accepted a versioned policy". Accounts created before this shipped therefore
 *   report as out of date and are prompted exactly once, with no migration script.
 *
 *   `POST /auth/legal/accept` re-stamps the current versions for an authenticated user - the
 *   endpoint behind the re-consent gate shown when a version bumps.
 *
 * Validation order matters: the consent check runs *after* the existing field/password/captcha
 * validation, so specs asserting those messages (credentialPolicy.test.ts) are unaffected.
 */

const signupPayload = {
    fullName: 'Consent User',
    email: 'consent@example.com',
    password: 'TestPassword123!',
    acceptedTerms: true,
    ageAttested: true,
}

describe('Legal acceptance at signup', () => {
    it('records the consent and attestation when both flags are sent', async () => {
        const res = await request(app).post('/api/v1/auth/register').send(signupPayload)

        expect(res.status).toBe(201)

        const user = await User.findById(res.body.data.user._id)
        expect(user?.legalAcceptance).toBeTruthy()
        expect(user?.legalAcceptance?.ageAttested).toBe(true)
        expect(user?.legalAcceptance?.termsVersion).toBe(TERMS_VERSION)
        expect(user?.legalAcceptance?.privacyVersion).toBe(PRIVACY_VERSION)
        expect(user?.legalAcceptance?.acceptedAt).toBeInstanceOf(Date)
    })

    it('rejects a signup that does not accept the terms', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...signupPayload, acceptedTerms: false })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.TERMS_NOT_ACCEPTED)
        expect(await User.countDocuments({ email: signupPayload.email })).toBe(0)
    })

    it('rejects a signup that does not attest to being 18 or older', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...signupPayload, ageAttested: false })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.AGE_NOT_ATTESTED)
        expect(await User.countDocuments({ email: signupPayload.email })).toBe(0)
    })

    it('rejects a signup that omits the flags entirely', async () => {
        const res = await request(app).post('/api/v1/auth/register').send({
            fullName: signupPayload.fullName,
            email: signupPayload.email,
            password: signupPayload.password,
        })

        expect(res.status).toBe(400)
        expect(await User.countDocuments({ email: signupPayload.email })).toBe(0)
    })

    it('ignores a client-supplied version and stamps the server values', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...signupPayload, termsVersion: 'not-a-real-version', privacyVersion: '99.99' })

        expect(res.status).toBe(201)

        const user = await User.findById(res.body.data.user._id)
        expect(user?.legalAcceptance?.termsVersion).toBe(TERMS_VERSION)
        expect(user?.legalAcceptance?.privacyVersion).toBe(PRIVACY_VERSION)
    })
})

describe('Legal acceptance status and re-consent', () => {
    it('reports the current versions alongside the stored acceptance on the profile', async () => {
        const { token } = await registerUser(app)

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.legalVersions).toEqual({
            termsVersion: TERMS_VERSION,
            privacyVersion: PRIVACY_VERSION,
        })
        expect(res.body.data.legalAcceptance.termsVersion).toBe(TERMS_VERSION)
    })

    it('treats an account with no stored acceptance as out of date', async () => {
        const { token, userId } = await registerUser(app)
        await User.findByIdAndUpdate(userId, { $unset: { legalAcceptance: 1 } })

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.legalAcceptance).toBeFalsy()
    })

    it('re-stamps the current versions when the user accepts again', async () => {
        const { token, userId } = await registerUser(app)
        await User.findByIdAndUpdate(userId, {
            'legalAcceptance.termsVersion': 'stale-version',
        })

        const res = await request(app)
            .post('/api/v1/auth/legal/accept')
            .set(authHeader(token))
            .send({})

        expect(res.status).toBe(200)

        const user = await User.findById(userId)
        expect(user?.legalAcceptance?.termsVersion).toBe(TERMS_VERSION)
        expect(user?.legalAcceptance?.privacyVersion).toBe(PRIVACY_VERSION)
    })

    it('creates an acceptance record for an account that never had one', async () => {
        const { token, userId } = await registerUser(app)
        await User.findByIdAndUpdate(userId, { $unset: { legalAcceptance: 1 } })

        const res = await request(app)
            .post('/api/v1/auth/legal/accept')
            .set(authHeader(token))
            .send({})

        expect(res.status).toBe(200)

        const user = await User.findById(userId)
        expect(user?.legalAcceptance?.termsVersion).toBe(TERMS_VERSION)
        expect(user?.legalAcceptance?.ageAttested).toBe(true)
    })

    it('requires authentication', async () => {
        const res = await request(app).post('/api/v1/auth/legal/accept').send({})
        expect(res.status).toBe(401)
    })
})
