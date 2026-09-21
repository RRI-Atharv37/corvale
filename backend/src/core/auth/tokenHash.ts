import crypto from 'node:crypto'

export const RECOVERY_CODE_COUNT = 10

const RECOVERY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export const sha256Hex = (value: string): string => crypto.createHash('sha256').update(value, 'utf8').digest('hex')

export const generateOpaqueToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url')

/** Compares by digest so unequal lengths neither throw nor leak the length through timing. */
export const timingSafeEqualStrings = (a: string, b: string): boolean =>
    crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest())

const randomGroup = (length: number): string => {
    let out = ''
    while (out.length < length) {
        out += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]
    }
    return out
}

export const normalizeRecoveryCode = (value: string): string => value.trim().toLowerCase().replace(/-/g, '')

/** `xxxxx-xxxxx`, 50 bits each; stored only as a hash of the normalised form. */
export const generateRecoveryCodes = (count = RECOVERY_CODE_COUNT): string[] => {
    const codes = new Set<string>()
    while (codes.size < count) codes.add(`${randomGroup(5)}-${randomGroup(5)}`)
    return [...codes]
}
