import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '../app'
import Transaction from '../models/Transaction'
import { authHeader, registerUser } from './helpers'
import { RECEIPT_UPLOAD_ROOT, getReceiptFilePath } from '../utils/receiptUtils'
import { setReceiptObjectStorage, type ReceiptObjectStorage } from '../utils/receiptStorage'
import { createBackupZipStream, exportUserBackup } from '../utils/backupUtils'

/**
 * SEC-53: the ZIP backup export must read every receipt from the *configured* storage driver,
 * or fail loudly. Before this it only ever read `uploads/receipts/<userId>/` from local disk
 * (`fs.existsSync` + `archive.file`), so under `RECEIPT_STORAGE_DRIVER=s3` — where the local
 * copy is deleted right after upload — the export silently shipped a ZIP with the backup JSON
 * but zero receipt files, contradicting the `privacy.md` "you can export all your data" promise.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as new (buf: Buffer) => {
    getEntries: () => { entryName: string }[]
    readFile: (name: string) => Buffer | null
}

const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'sample-receipt.png')
const PNG_BYTES = fs.readFileSync(FIXTURE_PNG)

const streamToBuffer = (stream: NodeJS.ReadableStream): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
    })

const s3Fake = (overrides: Partial<ReceiptObjectStorage> = {}): ReceiptObjectStorage => ({
    putObject: vi.fn().mockResolvedValue(undefined),
    getObjectBuffer: vi.fn().mockResolvedValue(PNG_BYTES),
    getSignedDownloadUrl: vi.fn().mockResolvedValue('https://storage.example/signed'),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
})

const uploadAndAttachReceipt = async (
    token: string,
    userId: string
): Promise<{ receiptId: string; transactionId: string }> => {
    const upload = await request(app)
        .post('/api/v1/receipts')
        .set(authHeader(token))
        .attach('receipt', FIXTURE_PNG)
    expect(upload.status).toBe(201)
    const receiptId = upload.body.data._id as string

    const transaction = await Transaction.create({
        userId,
        accountId: new Types.ObjectId(),
        categoryId: new Types.ObjectId(),
        type: 'expense',
        status: 'posted',
        amount: 1000,
        currency: 'USD',
        title: 'Receipt export test',
        date: new Date(),
    })

    const attach = await request(app)
        .post(`/api/v1/transactions/${transaction._id.toString()}/receipts`)
        .set(authHeader(token))
        .send({ receiptId })
    expect(attach.status).toBe(200)

    return { receiptId, transactionId: transaction._id.toString() }
}

afterEach(() => {
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
    delete process.env.RECEIPT_STORAGE_DRIVER
    setReceiptObjectStorage(null)
    vi.restoreAllMocks()
})

describe('Backup ZIP export — receipt bytes (SEC-53)', () => {
    it('includes the receipt file from local disk on the default driver (regression)', async () => {
        const { token, userId } = await registerUser(app)
        await uploadAndAttachReceipt(token, userId)

        const payload = await exportUserBackup(userId, null)
        expect(payload.receipts).toHaveLength(1)
        const storedFilename = String(payload.receipts[0].storedFilename)

        const { stream } = await createBackupZipStream(userId, payload)
        const zip = new AdmZip(await streamToBuffer(stream))

        expect(zip.getEntries().map((e) => e.entryName)).toContain(`receipts/${storedFilename}`)
        expect(zip.readFile(`receipts/${storedFilename}`)).toEqual(PNG_BYTES)
    })

    it('fetches the receipt bytes from the object-storage driver under RECEIPT_STORAGE_DRIVER=s3', async () => {
        process.env.RECEIPT_STORAGE_DRIVER = 's3'
        const objects = new Map<string, Buffer>()
        const getObjectBuffer = vi.fn(async (key: string) => {
            const bytes = objects.get(key)
            if (!bytes) throw new Error(`NoSuchKey: ${key}`)
            return bytes
        })
        setReceiptObjectStorage(
            s3Fake({
                putObject: vi.fn(async (key: string, sourceFilePath: string) => {
                    objects.set(key, fs.readFileSync(sourceFilePath))
                }),
                getObjectBuffer,
            })
        )

        const { token, userId } = await registerUser(app)
        await uploadAndAttachReceipt(token, userId)

        const payload = await exportUserBackup(userId, null)
        const storedFilename = String(payload.receipts[0].storedFilename)

        // The local staging copy is gone under the s3 driver — the export must not depend on it.
        expect(fs.existsSync(getReceiptFilePath(userId, storedFilename))).toBe(false)

        const { stream } = await createBackupZipStream(userId, payload)
        const zip = new AdmZip(await streamToBuffer(stream))

        expect(getObjectBuffer).toHaveBeenCalledWith(`${userId}/${storedFilename}`)
        expect(zip.readFile(`receipts/${storedFilename}`)).toEqual(PNG_BYTES)
    })

    it('fails loudly instead of shipping a receipt-less ZIP when the driver read fails', async () => {
        process.env.RECEIPT_STORAGE_DRIVER = 's3'
        setReceiptObjectStorage(
            s3Fake({ getObjectBuffer: vi.fn().mockRejectedValue(new Error('S3 unreachable')) })
        )

        const { token, userId } = await registerUser(app)
        await uploadAndAttachReceipt(token, userId)

        const payload = await exportUserBackup(userId, null)
        await expect(createBackupZipStream(userId, payload)).rejects.toThrow()
    })

    it('GET /backup/export?format=zip returns an error, not a partial ZIP, when receipts cannot be read', async () => {
        process.env.RECEIPT_STORAGE_DRIVER = 's3'
        setReceiptObjectStorage(
            s3Fake({
                putObject: vi.fn().mockResolvedValue(undefined),
                getObjectBuffer: vi.fn().mockRejectedValue(new Error('S3 unreachable')),
            })
        )

        const { token, userId } = await registerUser(app)
        await uploadAndAttachReceipt(token, userId)

        const res = await request(app)
            .get('/api/v1/backup/export')
            .query({ format: 'zip' })
            .set(authHeader(token))

        expect(res.status).toBe(500)
        expect(res.headers['content-type'] ?? '').not.toMatch(/zip/)
        expect(res.body.success).toBe(false)
    })
})
