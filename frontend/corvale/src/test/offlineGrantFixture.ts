import { SignJWT, importPKCS8 } from 'jose'

/**
 * Test-only ES256 keypair for the offline session grant (S16, SEC-18). The public half lives in
 * `frontend/corvale/.env.test`'s `VITE_OFFLINE_GRANT_PUBLIC_KEY` (loaded automatically by
 * Vite/Vitest in "test" mode); this is the matching private half, used only to mint grants for
 * tests. Never reused anywhere outside the suite.
 */
const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzSWzErj41Bi1saYV
BmRZPAilchXXmDfafeHmhbasJe2hRANCAASgylw3dpF2vnFfZzMs3IaJfORpfv6k
HwDfezcdizFaJ1mlp3JTOqQXIfWkYwupdH/BanTSRwqwkh8bl1hH16k6
-----END PRIVATE KEY-----`

export const createTestOfflineGrant = async (
    userId: string,
    options: { expiresInSeconds?: number } = {}
): Promise<string> => {
    const key = await importPKCS8(TEST_PRIVATE_KEY_PEM, 'ES256')
    const expiresIn = options.expiresInSeconds ?? 30 * 24 * 60 * 60

    return new SignJWT({})
        .setProtectedHeader({ alg: 'ES256' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
        .sign(key)
}
