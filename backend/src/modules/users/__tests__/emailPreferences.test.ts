import request from 'supertest'
import { describe, expect, it } from 'vitest'

import app from '@http/app'
import { User } from '@modules/users'
import { buildUnsubscribeToken, unsubscribeFromMarketing } from '@modules/users/emailPreferences.service'
import { seedUserDirectly } from '@tests/helpers'

/**
 * M9c - the win-back email is marketing to a lapsed user, so it carries an opt-out that works
 * without signing in. The token is an HMAC over the user id: nothing is stored, it cannot be
 * forged, and it stays valid for as long as the email sits in an inbox.
 */

const ENDPOINT = '/api/v1/auth/email-preferences/unsubscribe'

describe('marketing preference', () => {
    it('defaults to opted in for every user', async () => {
        const { userId } = await seedUserDirectly({ email: 'default-pref@example.com' })

        const stored = await User.findById(userId).lean()

        expect(stored?.emailPreferences?.marketing).toBe(true)
    })
})

describe('buildUnsubscribeToken / unsubscribeFromMarketing', () => {
    it('opts the user out and is idempotent', async () => {
        const { userId } = await seedUserDirectly({ email: 'unsub-service@example.com' })
        const token = buildUnsubscribeToken(userId)

        await unsubscribeFromMarketing(token)
        await unsubscribeFromMarketing(token)

        expect((await User.findById(userId).lean())?.emailPreferences?.marketing).toBe(false)
    })

    it('rejects a token for a different user, a tampered signature and garbage', async () => {
        const first = await seedUserDirectly({ email: 'unsub-a@example.com' })
        const second = await seedUserDirectly({ email: 'unsub-b@example.com' })
        const [, signature] = buildUnsubscribeToken(first.userId).split('.')

        await expect(unsubscribeFromMarketing(`${second.userId}.${signature}`)).rejects.toMatchObject({ statusCode: 400 })
        await expect(unsubscribeFromMarketing(`${first.userId}.${signature.slice(0, -2)}xx`)).rejects.toMatchObject({ statusCode: 400 })
        await expect(unsubscribeFromMarketing('not-a-token')).rejects.toMatchObject({ statusCode: 400 })
        await expect(unsubscribeFromMarketing('')).rejects.toMatchObject({ statusCode: 400 })

        expect((await User.findById(second.userId).lean())?.emailPreferences?.marketing).toBe(true)
    })

    it('accepts a valid token for an account that no longer exists without revealing that', async () => {
        const { userId } = await seedUserDirectly({ email: 'unsub-gone@example.com' })
        const token = buildUnsubscribeToken(userId)
        await User.deleteOne({ _id: userId })

        await expect(unsubscribeFromMarketing(token)).resolves.toBeUndefined()
    })
})

describe(`POST ${ENDPOINT}`, () => {
    it('opts the user out with no session', async () => {
        const { userId } = await seedUserDirectly({ email: 'unsub-http@example.com' })

        const res = await request(app).post(ENDPOINT).send({ token: buildUnsubscribeToken(userId) })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect((await User.findById(userId).lean())?.emailPreferences?.marketing).toBe(false)
    })

    it('answers 400 for an invalid or missing token', async () => {
        expect((await request(app).post(ENDPOINT).send({ token: 'abc.def' })).status).toBe(400)
        expect((await request(app).post(ENDPOINT).send({})).status).toBe(400)
    })
})
