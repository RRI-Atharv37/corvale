import request from 'supertest'
import { describe, expect, it } from 'vitest'

import app from '@http/app'
import RefreshToken from '@modules/auth/refreshToken.model'
import { createRefreshToken } from '@modules/auth/refreshToken.service'
import { revokeAllSessions } from '@modules/auth/sessionRevocation.service'
import { User } from '@modules/users'
import { authHeader, registerUser } from '@tests/helpers'

/**
 * SEC-95 - rotating `JWT_SECRET` does not end sessions: refresh tokens are random values stored as
 * hashes, so each one still mints an access token under the new secret. A real global logout revokes
 * every refresh token and bumps every `tokenVersion` (which also kills outstanding access tokens).
 */

describe('revokeAllSessions (SEC-95)', () => {
    it('revokes every live refresh token for every user', async () => {
        const a = await registerUser(app, { email: 'revoke-a@example.com' })
        const b = await registerUser(app, { email: 'revoke-b@example.com' })
        const rawA = await createRefreshToken(a.userId)
        await createRefreshToken(b.userId)

        const result = await revokeAllSessions()

        expect(result.refreshTokensRevoked).toBeGreaterThanOrEqual(2)
        expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0)

        const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', [`corvale_refresh=${rawA}`])
        expect(res.status).toBe(401)
    })

    it('bumps every tokenVersion so an outstanding access token stops working', async () => {
        const { userId, token } = await registerUser(app, { email: 'revoke-tv@example.com' })
        const before = (await User.findById(userId))!.tokenVersion

        const result = await revokeAllSessions()

        expect(result.usersInvalidated).toBeGreaterThanOrEqual(1)
        expect((await User.findById(userId))!.tokenVersion).toBe(before + 1)
        const res = await request(app).get('/api/v1/auth/user').set(authHeader(token))
        expect(res.status).toBe(401)
    })

    it('reports what it would do on a dry run and changes nothing', async () => {
        const { userId } = await registerUser(app, { email: 'revoke-dry@example.com' })
        await createRefreshToken(userId)
        const before = (await User.findById(userId))!.tokenVersion

        const result = await revokeAllSessions({ dryRun: true })

        expect(result.refreshTokensRevoked).toBeGreaterThanOrEqual(1)
        expect(await RefreshToken.countDocuments({ revokedAt: null })).toBeGreaterThanOrEqual(1)
        expect((await User.findById(userId))!.tokenVersion).toBe(before)
    })
})
