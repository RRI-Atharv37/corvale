import crypto from 'node:crypto'

const VERSION = 'v1'
const KEY_BYTES = 32
const IV_BYTES = 12

/** A 64-character hex string or a base64 string, either decoding to exactly 32 bytes. */
export const parseEncryptionKey = (raw: string): Buffer => {
    const trimmed = raw.trim()
    const key = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64')
    if (key.length !== KEY_BYTES) {
        throw new Error('Encryption key must be 32 bytes, given as 64 hex characters or base64')
    }
    return key
}

/** AES-256-GCM with a fresh nonce per call: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. */
export const sealSecret = (plaintext: string, key: Buffer): string => {
    const iv = crypto.randomBytes(IV_BYTES)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

export const openSecret = (sealed: string, key: Buffer): string => {
    const [version, iv, tag, body, ...rest] = sealed.split('.')
    if (version !== VERSION || !iv || !tag || body === undefined || rest.length > 0) {
        throw new Error('Unrecognised sealed secret')
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}
