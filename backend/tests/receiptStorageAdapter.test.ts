import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import app from '../app'
import Receipt from '../models/Receipt'
import { authHeader, registerUser } from './helpers'
import { RECEIPT_UPLOAD_ROOT } from '../utils/receiptUtils'
import { isObjectStorageConfigured, setReceiptObjectStorage } from '../utils/receiptStorage'

/**
 * Acceptance spec for receipts on object storage (L3, SEC-23).
 *
 * Today every receipt lands on local disk under `uploads/receipts/<userId>/` (see
 * `utils/receiptUtils.ts`), unencrypted, un-quota'd, and gone on the next deploy of any
 * container platform. SEC-23 calls this a hosting blocker for G1, not a nice-to-have.
 *
 * Contract assumed here for the new `backend/utils/receiptStorage.ts` module, deliberately
 * mirroring the `mailService.ts` / `setMailTransport` seam T0's `smtpDelivery.test.ts` already
 * established (env-driven selection in production, an injectable fake in tests so no real
 * network call is ever made):
 *
 *   export interface ReceiptObjectStorage {
 *     putObject(key: string, sourceFilePath: string, contentType: string): Promise<void>
 *     getObjectBuffer(key: string): Promise<Buffer>   // SEC-53: ZIP backup export
 *     getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
 *     deleteObject(key: string): Promise<void>
 *   }
 *   export const setReceiptObjectStorage(adapter: ReceiptObjectStorage | null): void  // test seam
 *   export const isObjectStorageConfigured(): boolean   // true iff RECEIPT_STORAGE_DRIVER === 's3'
 *   export const receiptObjectKey(userId: string, storedFilename: string): string  // `${userId}/${storedFilename}`
 *   export const RECEIPT_SIGNED_URL_EXPIRY_SECONDS: number   // short-lived, per SEC-23's recommendation
 *
 * Production builds `ReceiptObjectStorage` from an S3-compatible client configured via
 * `RECEIPT_S3_*` env vars (bucket, region, endpoint, credentials) and applies server-side
 * encryption on every `putObject`; that construction is intentionally not exercised here (it
 * would require a real or heavily-mocked AWS SDK) — this spec instead pins the *contract* the
 * controllers must honor against any conforming adapter, exactly as `smtpDelivery.test.ts` pins
 * `mailService`'s contract without asserting on nodemailer internals.
 *
 * Controller wiring assumed in `receiptController.ts`:
 *   - `uploadReceipt`: once virus scanning passes, if `isObjectStorageConfigured()` is true, the
 *     file is pushed through `putObject` under `receiptObjectKey(userId, storedFilename)` and the
 *     local temp copy multer wrote is deleted immediately after — object storage becomes the only
 *     copy, so a redeploy can no longer lose it.
 *   - `getReceiptFile`: when object storage is configured, responds `302` with `Location` set to
 *     `getSignedDownloadUrl(...)` rather than streaming the file itself.
 *   - `deleteReceipt`: routes the delete through `deleteObject` instead of the local `fs.unlink`.
 *   - A new per-user storage quota (`RECEIPT_STORAGE_QUOTA_BYTES`, applies under either driver)
 *     is enforced in `uploadReceipt` by summing the caller's existing non-deleted `Receipt.size`
 *     before accepting a new file.
 */

const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'sample-receipt.png')
const FIXTURE_PNG_SIZE = fs.statSync(FIXTURE_PNG).size

afterEach(() => {
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
    delete process.env.RECEIPT_STORAGE_DRIVER
    delete process.env.RECEIPT_STORAGE_QUOTA_BYTES
    setReceiptObjectStorage(null)
    vi.restoreAllMocks()
})

describe('Receipt storage: local driver stays the default (regression)', () => {
    it('isObjectStorageConfigured is false with no driver env var set', () => {
        expect(isObjectStorageConfigured()).toBe(false)
    })

    it('still serves the receipt bytes directly (200), not a redirect, on the local driver', async () => {
        const { token } = await registerUser(app)
        const uploadRes = await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)

        const res = await request(app)
            .get(`/api/v1/receipts/${uploadRes.body.data._id}`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
    })
})

describe('Receipt storage: S3-compatible driver (L3, SEC-23)', () => {
    const configureS3Driver = () => {
        process.env.RECEIPT_STORAGE_DRIVER = 's3'
    }

    it('routes an upload through putObject and does not leave a local copy behind', async () => {
        configureS3Driver()
        const putObject = vi.fn().mockResolvedValue(undefined)
        setReceiptObjectStorage({
            putObject,
            getObjectBuffer: vi.fn().mockResolvedValue(Buffer.alloc(0)),
            getSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example/signed'),
            deleteObject: vi.fn().mockResolvedValue(undefined),
        })

        const { token, userId } = await registerUser(app)
        const res = await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(201)
        expect(putObject).toHaveBeenCalledTimes(1)

        const [key, , contentType] = putObject.mock.calls[0]
        expect(key.startsWith(`${userId}/`)).toBe(true)
        expect(contentType).toMatch(/^image\//)

        // No local receipt directory should remain for this user once the object-storage
        // upload has succeeded - the local disk copy was only ever a staging step.
        const localDir = path.join(RECEIPT_UPLOAD_ROOT, userId)
        const remainingFiles = fs.existsSync(localDir) ? fs.readdirSync(localDir) : []
        expect(remainingFiles).toHaveLength(0)
    })

    it('redirects GET /receipts/:id to a short-lived signed URL instead of streaming the file', async () => {
        configureS3Driver()
        const signedUrl = 'https://storage.example/bucket/signed-download?sig=abc123'
        const getSignedDownloadUrl = vi.fn().mockResolvedValue(signedUrl)
        setReceiptObjectStorage({
            putObject: vi.fn().mockResolvedValue(undefined),
            getSignedDownloadUrl,
            deleteObject: vi.fn().mockResolvedValue(undefined),
        })

        const { token, userId } = await registerUser(app)
        const uploadRes = await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)

        const res = await request(app)
            .get(`/api/v1/receipts/${uploadRes.body.data._id}`)
            .set(authHeader(token))
            .redirects(0)

        expect(res.status).toBe(302)
        expect(res.headers.location).toBe(signedUrl)
        expect(getSignedDownloadUrl).toHaveBeenCalledTimes(1)

        const [key, expiresInSeconds] = getSignedDownloadUrl.mock.calls[0]
        expect(key.startsWith(`${userId}/`)).toBe(true)
        // "Short-lived" per SEC-23's recommendation - a few minutes, not hours.
        expect(expiresInSeconds).toBeGreaterThan(0)
        expect(expiresInSeconds).toBeLessThanOrEqual(15 * 60)
    })

    it('routes a delete through deleteObject with the same key convention', async () => {
        configureS3Driver()
        const deleteObject = vi.fn().mockResolvedValue(undefined)
        setReceiptObjectStorage({
            putObject: vi.fn().mockResolvedValue(undefined),
            getObjectBuffer: vi.fn().mockResolvedValue(Buffer.alloc(0)),
            getSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example/signed'),
            deleteObject,
        })

        const { token, userId } = await registerUser(app)
        const uploadRes = await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)

        const res = await request(app)
            .delete(`/api/v1/receipts/${uploadRes.body.data._id}`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(deleteObject).toHaveBeenCalledTimes(1)
        expect(deleteObject.mock.calls[0][0].startsWith(`${userId}/`)).toBe(true)
    })
})

describe('Receipt storage: per-user quota (L3, SEC-23)', () => {
    it('accepts an upload that fits exactly under the configured quota', async () => {
        process.env.RECEIPT_STORAGE_QUOTA_BYTES = String(FIXTURE_PNG_SIZE)
        const { token } = await registerUser(app)

        const res = await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(201)
    })

    it('rejects an upload that would push the user over their storage quota', async () => {
        process.env.RECEIPT_STORAGE_QUOTA_BYTES = String(FIXTURE_PNG_SIZE)
        const { token } = await registerUser(app)

        await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)
        const secondRes = await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)

        expect(secondRes.status).toBe(400)
        expect(secondRes.body.message).toMatch(/quota|storage limit/i)
    })

    it('does not count another user toward the caller\'s quota', async () => {
        process.env.RECEIPT_STORAGE_QUOTA_BYTES = String(FIXTURE_PNG_SIZE)
        const first = await registerUser(app, { email: 'quota-a@example.com' })
        const second = await registerUser(app, { email: 'quota-b@example.com' })

        await request(app).post('/api/v1/receipts').set(authHeader(first.token)).attach('receipt', FIXTURE_PNG)
        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(second.token))
            .attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(201)
    })

    it('excludes soft-deleted receipts from the quota calculation', async () => {
        process.env.RECEIPT_STORAGE_QUOTA_BYTES = String(FIXTURE_PNG_SIZE)
        const { token } = await registerUser(app)

        const first = await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)
        await request(app).delete(`/api/v1/receipts/${first.body.data._id}`).set(authHeader(token))

        const receiptCountBeforeSecondUpload = await Receipt.countDocuments({ deletedAt: null })
        expect(receiptCountBeforeSecondUpload).toBe(0)

        const secondRes = await request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)
        expect(secondRes.status).toBe(201)
    })
})
