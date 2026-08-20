/**
 * Client-generated record `_id`s (Sprint 13.9+ page migrations): per
 * ROADMAP.md's "Identity" decision, every syncable create is assigned a
 * client-side 24-hex ObjectId-shaped id up front, accepted as-is by the
 * corresponding server create endpoint (`resolveClientObjectId` on the
 * backend). 12 random bytes hex-encoded is both a valid `mongoose.Types.ObjectId`
 * string and collision-safe enough for this purpose (96 bits of randomness).
 */
export const generateLocalObjectId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
