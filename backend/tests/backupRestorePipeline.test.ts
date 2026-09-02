import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '../app'
import Receipt from '../models/Receipt'
import { authHeader, registerUser } from './helpers'
import {
    RECEIPT_UPLOAD_ROOT,
    getReceiptFilePath,
    getUserReceiptStorageUsageBytes,
} from '../utils/receiptUtils'
import { setVirusScanHandlerForTests } from '@infra/security/virusScanService'
import { setReceiptObjectStorage } from '@infra/storage/receiptStorage'

/**
 * Acceptance spec for S21 / SEC-28 — backup restore must not be a side door around the
 * controls `POST /receipts` enforces.
 *
 * Before this sprint, `restoreUserBackup` (`utils/backupUtils.ts`) wrote each receipt file
 * straight to disk and copied `mimeType` and `size` verbatim from the backup JSON — no
 * magic-byte sniff (SEC-15), no virus scan, no MIME allowlist, and no storage-quota check
 * (SEC-23). A crafted ZIP could therefore:
 *   - park arbitrary bytes on the API origin, served back with an attacker-chosen Content-Type
 *   - report `size: 0` for a real file, permanently defeating the per-user quota
 *
 * Contract asserted here:
 *   - The restored file's bytes are sniffed; the *detected* type is stored, the declared one
 *     is ignored. Bytes matching none of JPEG/PNG/WebP/PDF are rejected (400), nothing persists.
 *   - `Receipt.size` is the actual buffer length, never the payload's number.
 *   - `scanUploadedFile` runs on the written file; an infected verdict rejects the restore and
 *     leaves no file on disk.
 *   - `assertWithinReceiptStorageQuota` applies, counting the real size.
 *   - With object storage configured, the file is pushed through `putObject` and no local copy
 *     is left behind — same as `uploadReceipt`.
 *   - `parseBackupPayload` rejects structurally broken records instead of trusting the payload
 *     past the "is it an array" gate.
 *   - `ReceiptSchema.mimeType` carries an `enum` as a last line of defence.
 */

const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'sample-receipt.png')
const PNG_BYTES = fs.readFileSync(FIXTURE_PNG)
const HTML_BYTES = Buffer.from('<html><body><script>alert(1)</script></body></html>')

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as new () => {
    addFile: (entryName: string, data: Buffer) => void
    toBuffer: () => Buffer
}

const emptyCounts = () => ({
    accounts: 0,
    categories: 0,
    tags: 0,
    budgets: 0,
    savingsGoals: 0,
    savingsGoalContributions: 0,
    recurringRules: 0,
    categorizationRules: 0,
    transactionTemplates: 0,
    transactions: 0,
    receipts: 0,
})

const buildPayload = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: { workspaceId: null },
    counts: emptyCounts(),
    accounts: [],
    categories: [],
    tags: [],
    budgets: [],
    savingsGoals: [],
    savingsGoalContributions: [],
    recurringRules: [],
    categorizationRules: [],
    transactionTemplates: [],
    transactions: [],
    receipts: [],
    ...overrides,
})

const buildRestoreZip = (
    payload: Record<string, unknown>,
    receiptEntries: { name: string; data: Buffer }[]
): Buffer => {
    const zip = new AdmZip()
    zip.addFile('corvale-backup.json', Buffer.from(JSON.stringify(payload)))
    for (const entry of receiptEntries) {
        zip.addFile(entry.name, entry.data)
    }
    return zip.toBuffer()
}

const receiptRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'src-receipt-1',
    originalFilename: 'receipt.png',
    storedFilename: 'stored-receipt-1.png',
    mimeType: 'image/png',
    size: 70,
    ...overrides,
})

afterEach(() => {
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
    delete process.env.VIRUS_SCAN_ENABLED
    delete process.env.VIRUS_SCAN_FAIL_CLOSED
    delete process.env.RECEIPT_STORAGE_DRIVER
    delete process.env.RECEIPT_STORAGE_QUOTA_BYTES
    setVirusScanHandlerForTests(null)
    setReceiptObjectStorage(null)
    vi.restoreAllMocks()
})

const listUserReceiptFiles = (userId: string): string[] => {
    const dir = path.join(RECEIPT_UPLOAD_ROOT, userId)
    return fs.existsSync(dir) ? fs.readdirSync(dir) : []
}

describe('Backup restore — receipt upload pipeline (S21, SEC-28)', () => {
    it('stores the sniffed MIME type and the real byte size, not the payload values', async () => {
        const { token, userId } = await registerUser(app, { email: 'sec28-sniff@example.com' })

        const payload = buildPayload({
            receipts: [
                receiptRecord({
                    // both of these are lies the restore must ignore
                    mimeType: 'application/pdf',
                    size: 9_999_999,
                }),
            ],
        })
        const zip = buildRestoreZip(payload, [
            { name: 'receipts/stored-receipt-1.png', data: PNG_BYTES },
        ])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'backup.zip')

        expect(res.status).toBe(201)
        expect(res.body.data.created.receipts).toBe(1)

        const stored = await Receipt.findOne({ userId })
        expect(stored?.mimeType).toBe('image/png')
        expect(stored?.size).toBe(PNG_BYTES.byteLength)
    })

    it('closes the quota bypass: a payload declaring size 0 still counts the real bytes', async () => {
        const { token, userId } = await registerUser(app, { email: 'sec28-quota0@example.com' })

        const payload = buildPayload({ receipts: [receiptRecord({ size: 0 })] })
        const zip = buildRestoreZip(payload, [
            { name: 'receipts/stored-receipt-1.png', data: PNG_BYTES },
        ])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'backup.zip')

        expect(res.status).toBe(201)
        expect(await getUserReceiptStorageUsageBytes(userId)).toBe(PNG_BYTES.byteLength)
    })

    it('rejects a restored receipt whose bytes match no allowed type (magic-byte sniff)', async () => {
        const { token, userId } = await registerUser(app, { email: 'sec28-magic@example.com' })

        const payload = buildPayload({
            receipts: [receiptRecord({ originalFilename: 'receipt.png', storedFilename: 'evil.png' })],
        })
        const zip = buildRestoreZip(payload, [{ name: 'receipts/evil.png', data: HTML_BYTES }])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'backup.zip')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/JPEG|PNG|WebP|PDF|file type/i)
        expect(await Receipt.countDocuments({ userId })).toBe(0)
        expect(listUserReceiptFiles(userId)).toHaveLength(0)
    })

    it('virus-scans the restored file and rejects an infected one, leaving nothing on disk', async () => {
        process.env.VIRUS_SCAN_ENABLED = 'true'
        process.env.VIRUS_SCAN_FAIL_CLOSED = 'true'
        setVirusScanHandlerForTests(async () => 'infected')

        const { token, userId } = await registerUser(app, { email: 'sec28-virus@example.com' })

        const payload = buildPayload({ receipts: [receiptRecord()] })
        const zip = buildRestoreZip(payload, [
            { name: 'receipts/stored-receipt-1.png', data: PNG_BYTES },
        ])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'backup.zip')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/security scan/i)
        expect(await Receipt.countDocuments({ userId })).toBe(0)
        expect(listUserReceiptFiles(userId)).toHaveLength(0)
    })

    it('enforces the per-user storage quota on restore', async () => {
        process.env.RECEIPT_STORAGE_QUOTA_BYTES = String(PNG_BYTES.byteLength - 1)
        const { token, userId } = await registerUser(app, { email: 'sec28-quota@example.com' })

        const payload = buildPayload({ receipts: [receiptRecord()] })
        const zip = buildRestoreZip(payload, [
            { name: 'receipts/stored-receipt-1.png', data: PNG_BYTES },
        ])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'backup.zip')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/quota|storage limit/i)
        expect(await Receipt.countDocuments({ userId })).toBe(0)
    })

    it('routes a restored receipt through object storage when configured, with no local copy left', async () => {
        process.env.RECEIPT_STORAGE_DRIVER = 's3'
        const putObject = vi.fn().mockResolvedValue(undefined)
        setReceiptObjectStorage({
            putObject,
            getObjectBuffer: vi.fn().mockResolvedValue(PNG_BYTES),
            getSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example/signed'),
            deleteObject: vi.fn().mockResolvedValue(undefined),
        })

        const { token, userId } = await registerUser(app, { email: 'sec28-s3@example.com' })

        const payload = buildPayload({ receipts: [receiptRecord()] })
        const zip = buildRestoreZip(payload, [
            { name: 'receipts/stored-receipt-1.png', data: PNG_BYTES },
        ])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'backup.zip')

        expect(res.status).toBe(201)
        expect(res.body.data.created.receipts).toBe(1)
        expect(putObject).toHaveBeenCalledTimes(1)

        const [key, , contentType] = putObject.mock.calls[0]
        expect(key.startsWith(`${userId}/`)).toBe(true)
        expect(contentType).toBe('image/png')
        expect(listUserReceiptFiles(userId)).toHaveLength(0)
    })

    it('skips receipt records with no matching file in the ZIP (JSON-only restore unchanged)', async () => {
        const { token, userId } = await registerUser(app, { email: 'sec28-nofile@example.com' })

        const payload = buildPayload({ receipts: [receiptRecord()] })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .send({ backup: payload })

        expect(res.status).toBe(201)
        expect(res.body.data.created.receipts).toBe(0)
        expect(await Receipt.countDocuments({ userId })).toBe(0)
    })
})

describe('parseBackupPayload — per-record validation (S21, SEC-28)', () => {
    it('rejects a backup whose receipt record is not an object', async () => {
        const { token } = await registerUser(app, { email: 'sec28-badrec@example.com' })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .send({ backup: buildPayload({ receipts: ['not-an-object'] }) })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/not a valid corvale backup/i)
    })

    it('rejects a receipt record missing storedFilename', async () => {
        const { token } = await registerUser(app, { email: 'sec28-nostored@example.com' })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .send({
                backup: buildPayload({
                    receipts: [{ id: 'r1', originalFilename: 'a.png', mimeType: 'image/png', size: 5 }],
                }),
            })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/not a valid corvale backup/i)
    })

    it('rejects a record that carries no id', async () => {
        const { token } = await registerUser(app, { email: 'sec28-noid@example.com' })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .send({ backup: buildPayload({ transactions: [{ amount: 100 }] }) })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/not a valid corvale backup/i)
    })

    it('still accepts a well-formed empty backup', async () => {
        const { token } = await registerUser(app, { email: 'sec28-empty@example.com' })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .send({ backup: buildPayload() })

        expect(res.status).toBe(201)
    })
})

describe('ReceiptSchema.mimeType enum (S21, SEC-28)', () => {
    it('rejects a Receipt whose mimeType is outside the allowlist', async () => {
        await expect(
            Receipt.create({
                userId: new Types.ObjectId(),
                originalFilename: 'x.html',
                storedFilename: 'x.html',
                mimeType: 'text/html',
                size: 10,
            })
        ).rejects.toThrow()
    })

    it('accepts a Receipt with an allowlisted mimeType', async () => {
        const created = await Receipt.create({
            userId: new Types.ObjectId(),
            originalFilename: 'x.png',
            storedFilename: 'x.png',
            mimeType: 'image/png',
            size: 10,
        })
        expect(created.mimeType).toBe('image/png')
    })
})
