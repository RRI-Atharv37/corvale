import { describe, expect, it } from 'vitest'

import {
    buildOtpauthUri,
    generateTotpCode,
    generateTotpSecret,
    verifyTotp,
} from '../totp'
import { openSecret, parseEncryptionKey, sealSecret } from '../secretBox'
import {
    generateOpaqueToken,
    generateRecoveryCodes,
    normalizeRecoveryCode,
    sha256Hex,
    timingSafeEqualStrings,
} from '../tokenHash'

/**
 * The TOTP algorithm is a maintained library's job; these vectors (RFC 6238, appendix B, SHA-1) are a
 * conformance check that OUR wrapper - secret encoding, digit count, step arithmetic - feeds it correctly.
 */
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totp wrapper - RFC 6238 conformance', () => {
    it.each([
        [59, '94287082'],
        [1111111109, '07081804'],
        [1111111111, '14050471'],
        [1234567890, '89005924'],
        [2000000000, '69279037'],
    ])('T=%i produces %s (8 digits)', (seconds, expected) => {
        expect(generateTotpCode(RFC_SECRET_BASE32, seconds * 1000, { digits: 8 })).toBe(expected)
    })

    it('generates six digits by default', () => {
        expect(generateTotpCode(generateTotpSecret(), Date.now())).toMatch(/^\d{6}$/)
    })
})

describe('totp verification', () => {
    const secret = generateTotpSecret()
    const now = 1_800_000_000_000

    it('accepts the current code and reports its step', () => {
        const result = verifyTotp(secret, generateTotpCode(secret, now), { timestampMs: now })

        expect(result).toEqual({ valid: true, step: Math.floor(now / 1000 / 30) })
    })

    it('accepts one step of drift either way and reports the step it matched', () => {
        const past = verifyTotp(secret, generateTotpCode(secret, now - 30_000), { timestampMs: now })
        const future = verifyTotp(secret, generateTotpCode(secret, now + 30_000), { timestampMs: now })

        expect(past).toEqual({ valid: true, step: Math.floor(now / 1000 / 30) - 1 })
        expect(future).toEqual({ valid: true, step: Math.floor(now / 1000 / 30) + 1 })
    })

    it('rejects two steps of drift', () => {
        expect(verifyTotp(secret, generateTotpCode(secret, now - 60_000), { timestampMs: now }).valid).toBe(false)
        expect(verifyTotp(secret, generateTotpCode(secret, now + 60_000), { timestampMs: now }).valid).toBe(false)
    })

    it.each(['', '12345', '1234567', 'abcdef', '12 345', 123456 as unknown as string])(
        'rejects a malformed token (%s) without throwing',
        (token) => {
            expect(verifyTotp(secret, token, { timestampMs: now }).valid).toBe(false)
        }
    )

    it('rejects a code made for another secret', () => {
        const other = generateTotpSecret()

        expect(verifyTotp(secret, generateTotpCode(other, now), { timestampMs: now }).valid).toBe(false)
    })
})

describe('otpauth uri', () => {
    it('carries issuer, label and secret and nothing else sensitive', () => {
        const uri = buildOtpauthUri({ secret: 'JBSWY3DPEHPK3PXP', label: 'ops@example.com', issuer: 'Corvale Admin' })

        expect(uri.startsWith('otpauth://totp/')).toBe(true)
        expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
        expect(uri).toContain('issuer=Corvale%20Admin')
        expect(uri).toContain('period=30')
        expect(uri).toContain('digits=6')
    })
})

describe('secret box (AES-256-GCM)', () => {
    const key = parseEncryptionKey('a'.repeat(64))

    it('round-trips a secret and never stores it in the clear', () => {
        const sealed = sealSecret('JBSWY3DPEHPK3PXP', key)

        expect(sealed).not.toContain('JBSWY3DPEHPK3PXP')
        expect(openSecret(sealed, key)).toBe('JBSWY3DPEHPK3PXP')
    })

    it('uses a fresh nonce every time', () => {
        expect(sealSecret('same', key)).not.toBe(sealSecret('same', key))
    })

    it('refuses a tampered ciphertext, tag, or the wrong key', () => {
        const sealed = sealSecret('JBSWY3DPEHPK3PXP', key)
        const [version, iv, tag, body] = sealed.split('.')
        const flipped = `${version}.${iv}.${tag}.${body.slice(0, -2)}${body.endsWith('AA') ? 'BB' : 'AA'}`

        expect(() => openSecret(flipped, key)).toThrow()
        expect(() => openSecret(sealed, parseEncryptionKey('b'.repeat(64)))).toThrow()
        expect(() => openSecret('garbage', key)).toThrow()
    })

    it('accepts a 64-char hex or a base64 key of 32 bytes and nothing else', () => {
        expect(parseEncryptionKey('0f'.repeat(32)).length).toBe(32)
        expect(parseEncryptionKey(Buffer.alloc(32, 7).toString('base64')).length).toBe(32)
        expect(() => parseEncryptionKey('short')).toThrow()
        expect(() => parseEncryptionKey(Buffer.alloc(16, 7).toString('base64'))).toThrow()
    })
})

describe('token helpers', () => {
    it('sha256Hex is stable and hex', () => {
        expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    })

    it('opaque tokens are long, url-safe and unique', () => {
        const a = generateOpaqueToken()
        const b = generateOpaqueToken()

        expect(a).toMatch(/^[A-Za-z0-9_-]{43,}$/)
        expect(a).not.toBe(b)
    })

    it('timingSafeEqualStrings compares by value, safe for unequal lengths', () => {
        expect(timingSafeEqualStrings('abc', 'abc')).toBe(true)
        expect(timingSafeEqualStrings('abc', 'abd')).toBe(false)
        expect(timingSafeEqualStrings('abc', 'abcd')).toBe(false)
        expect(timingSafeEqualStrings('', '')).toBe(true)
    })

    it('recovery codes are ten distinct, normalisable codes', () => {
        const codes = generateRecoveryCodes()

        expect(codes).toHaveLength(10)
        expect(new Set(codes).size).toBe(10)
        for (const code of codes) {
            expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/)
            expect(normalizeRecoveryCode(code.toUpperCase())).toBe(normalizeRecoveryCode(code))
            expect(normalizeRecoveryCode(` ${code} `)).toBe(code.replace('-', ''))
        }
    })
})
