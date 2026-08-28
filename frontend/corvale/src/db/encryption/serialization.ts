import type { EncryptedField } from './deriveKey'

/**
 * Wire format for an encrypted `data` column value (S8, SEC-01). Prefixed so
 * `isEncryptedField` can tell an encrypted row from a plain JSON blob written
 * before a PIN was ever configured (back-compat path in `Repository.ts`).
 */
const ENCRYPTED_PREFIX = 'enc:v1:'

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

export const serializeEncryptedField = (field: EncryptedField): string =>
  `${ENCRYPTED_PREFIX}${toBase64(field.iv)}:${toBase64(field.ciphertext)}`

export const isEncryptedField = (value: string): boolean => value.startsWith(ENCRYPTED_PREFIX)

export const parseEncryptedField = (serialized: string): EncryptedField => {
  const [ivPart, ciphertextPart] = serialized.slice(ENCRYPTED_PREFIX.length).split(':')
  return { iv: fromBase64(ivPart), ciphertext: fromBase64(ciphertextPart) }
}
