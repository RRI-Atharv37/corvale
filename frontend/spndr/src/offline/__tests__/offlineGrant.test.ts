import { describe, it, expect, afterEach } from 'vitest'
import { SignJWT, generateKeyPair } from 'jose'
import {
    clearOfflineGrant,
    getStoredOfflineGrant,
    storeOfflineGrant,
    verifyOfflineGrant,
} from '../offlineGrant'
import { createTestOfflineGrant } from '../../test/offlineGrantFixture'

/**
 * G2 acceptance spec (TODO.md S16, SEC-18).
 *
 * Replaces the old plain `spndr_session_valid_until` localStorage date - forgeable by simply
 * writing a future date into it - with a server-signed JWT the client verifies locally against
 * a public key it cannot use to mint or extend a grant itself. `verifyOfflineGrant` must fail
 * closed in every case except a signature that actually checks out against the configured
 * public key, for the expected user, before its `exp`.
 */

describe('offlineGrant storage', () => {
    afterEach(() => {
        clearOfflineGrant()
    })

    it('round-trips a stored grant', () => {
        storeOfflineGrant('some.jwt.value')
        expect(getStoredOfflineGrant()).toBe('some.jwt.value')
    })

    it('clears the stored grant', () => {
        storeOfflineGrant('some.jwt.value')
        clearOfflineGrant()
        expect(getStoredOfflineGrant()).toBeNull()
    })

    it('storing null removes any existing grant', () => {
        storeOfflineGrant('some.jwt.value')
        storeOfflineGrant(null)
        expect(getStoredOfflineGrant()).toBeNull()
    })
})

describe('verifyOfflineGrant', () => {
    it('accepts a grant signed by the configured key for the expected user', async () => {
        const grant = await createTestOfflineGrant('user1')
        expect(await verifyOfflineGrant(grant, 'user1')).toBe(true)
    })

    it('accepts a grant with no expected user supplied', async () => {
        const grant = await createTestOfflineGrant('user1')
        expect(await verifyOfflineGrant(grant)).toBe(true)
    })

    it('rejects a grant bound to a different user', async () => {
        const grant = await createTestOfflineGrant('user1')
        expect(await verifyOfflineGrant(grant, 'user2')).toBe(false)
    })

    it('rejects an expired grant', async () => {
        const grant = await createTestOfflineGrant('user1', { expiresInSeconds: -60 })
        expect(await verifyOfflineGrant(grant, 'user1')).toBe(false)
    })

    it('rejects a grant signed with a key other than the configured public key', async () => {
        const { privateKey } = await generateKeyPair('ES256')
        const forged = await new SignJWT({})
            .setProtectedHeader({ alg: 'ES256' })
            .setSubject('user1')
            .setIssuedAt()
            .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
            .sign(privateKey)

        expect(await verifyOfflineGrant(forged, 'user1')).toBe(false)
    })

    it('rejects a null grant', async () => {
        expect(await verifyOfflineGrant(null, 'user1')).toBe(false)
    })

    it('rejects a garbage string that is not a JWT', async () => {
        expect(await verifyOfflineGrant('not-a-jwt', 'user1')).toBe(false)
    })
})
