import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Receipt } from '@modules/receipts'
import { authHeader, registerUser } from './helpers'
import { RECEIPT_UPLOAD_ROOT } from "@modules/receipts/receiptUtils";

/**
 * Acceptance spec for receipt magic-byte validation (S14, SEC-15).
 *
 * Today `middleware/receiptUploadMiddleware.ts`'s `fileFilter` only checks `file.mimetype`,
 * which multer reads verbatim from the attacker-controlled multipart part header, and
 * `controllers/receiptController.ts` persists and later echoes that same declared value as
 * the download response's `Content-Type` with `Content-Disposition: inline` — there is no
 * check that the declared type matches the file's actual bytes.
 *
 * Contract assumed here for a new `backend/utils/fileSignature.ts` module:
 *
 *   export const detectReceiptSignature = (buffer: Buffer): ReceiptMimeType | null
 *     // Sniffs magic bytes: JPEG (FF D8 FF), PNG (89 50 4E 47 0D 0A 1A 0A),
 *     // WebP (RIFF....WEBP), PDF (%PDF-). Returns null when the bytes match none of them.
 *
 * `uploadReceipt` wiring assumed in `receiptController.ts`, running after the existing
 * `assertWithinReceiptStorageQuota` check and before (or alongside) `scanUploadedFile`:
 *   - Reads the uploaded file's bytes, runs `detectReceiptSignature`.
 *   - Rejects with `ERROR_MESSAGES.RECEIPT.INVALID_FILE_TYPE` (400) — the same message already
 *     used for a disallowed declared type, since a spoofed declaration is indistinguishable
 *     from an honestly-wrong one at the API boundary — when detection returns `null` *or*
 *     disagrees with the client-declared `mimetype`. The temp file is deleted on rejection,
 *     mirroring the existing quota/virus-scan reject-and-delete paths.
 *   - Persists the **detected** type as `Receipt.mimeType`, not the declared header, so nothing
 *     downstream ever trusts client input again.
 *
 * `getReceiptFile` wiring assumed:
 *   - Sets `X-Content-Type-Options: nosniff` on every response, independent of any global
 *     Helmet configuration.
 *   - Serves `application/pdf` with `Content-Disposition: attachment` (PDFs render inline in
 *     the browser's own PDF engine from the API origin otherwise); images stay `inline`.
 */

const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'sample-receipt.png')
const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF')

afterEach(() => {
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
})

describe('Receipt magic-byte validation (S14, SEC-15)', () => {
    it('accepts a real PNG whose declared type matches its bytes', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG, { filename: 'receipt.png', contentType: 'image/png' })

        expect(res.status).toBe(201)
        expect(res.body.data.mimeType).toBe('image/png')
    })

    it('accepts a minimal real PDF whose declared type matches its bytes', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', MINIMAL_PDF, { filename: 'receipt.pdf', contentType: 'application/pdf' })

        expect(res.status).toBe(201)
        expect(res.body.data.mimeType).toBe('application/pdf')
    })

    it('rejects a file whose bytes are not an image/PDF but which declares an allowed type', async () => {
        const { token } = await registerUser(app)
        const spoofed = Buffer.from('<html><body><script>alert(1)</script></body></html>')

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', spoofed, { filename: 'receipt.png', contentType: 'image/png' })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/JPEG|PNG|WebP|PDF|file type/i)

        const stored = await Receipt.find({})
        expect(stored).toHaveLength(0)
    })

    it('rejects a real PNG whose declared Content-Type disagrees with its bytes', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG, { filename: 'receipt.pdf', contentType: 'application/pdf' })

        expect(res.status).toBe(400)
        const stored = await Receipt.find({})
        expect(stored).toHaveLength(0)
    })

    it('does not leave an orphaned file on disk after a magic-byte rejection', async () => {
        const { token } = await registerUser(app)
        const spoofed = Buffer.from('not actually a pdf')

        await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', spoofed, { filename: 'receipt.pdf', contentType: 'application/pdf' })

        if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
            const walk = (dir: string): string[] =>
                fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
                    entry.isDirectory()
                        ? walk(path.join(dir, entry.name))
                        : [path.join(dir, entry.name)]
                )
            expect(walk(RECEIPT_UPLOAD_ROOT)).toHaveLength(0)
        }
    })

    it('sets X-Content-Type-Options: nosniff on the download response', async () => {
        const { token } = await registerUser(app)

        const uploadRes = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG, { filename: 'receipt.png', contentType: 'image/png' })

        const receiptId = uploadRes.body.data._id
        const downloadRes = await request(app)
            .get(`/api/v1/receipts/${receiptId}`)
            .set(authHeader(token))

        expect(downloadRes.headers['x-content-type-options']).toBe('nosniff')
    })

    it('serves PDFs as an attachment, not inline', async () => {
        const { token } = await registerUser(app)

        const uploadRes = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', MINIMAL_PDF, { filename: 'receipt.pdf', contentType: 'application/pdf' })

        const receiptId = uploadRes.body.data._id
        const downloadRes = await request(app)
            .get(`/api/v1/receipts/${receiptId}`)
            .set(authHeader(token))

        expect(downloadRes.headers['content-disposition']).toMatch(/^attachment/)
    })
})
