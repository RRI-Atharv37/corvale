import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import app from '../app'
import { registerUser, authHeader } from './helpers'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as new () => {
    addFile: (entryName: string, data: Buffer) => void
    toBuffer: () => Buffer
}

/**
 * G2 acceptance spec (TODO.md T2 -> S15, SEC-16).
 *
 * `backend/utils/backupUtils.ts`'s `extractBackupFromUpload` (:755-814) today only bounds the
 * **compressed** size of an uploaded backup (`BACKUP_MAX_ZIP_BYTES`, 50 MB) before handing the
 * buffer to `AdmZip` and calling `entry.getData()` on every entry, which inflates each one fully
 * into memory. A small, highly-compressible zip can therefore exhaust the process heap — a full
 * availability loss, since the backend is single-process per instance. Zip Slip is separately
 * verified-safe (every entry name is reduced through `path.basename` before use) and is not
 * re-tested here.
 *
 * Contract assumed here, all read from the zip's central directory (`entry.header.size` for
 * declared uncompressed size, `entry.header.compressedSize`) — so a hostile archive is rejected
 * without ever calling `entry.getData()` on it:
 *
 *   export const BACKUP_MAX_UNCOMPRESSED_BYTES: number   // env `BACKUP_MAX_UNCOMPRESSED_BYTES`
 *   export const BACKUP_MAX_ZIP_ENTRIES: number           // env `BACKUP_MAX_ZIP_ENTRIES`
 *   export const BACKUP_MAX_COMPRESSION_RATIO: number     // env `BACKUP_MAX_COMPRESSION_RATIO`
 *
 * `extractBackupFromUpload` walks `zip.getEntries()` once up front and throws a new
 * `ERROR_MESSAGES.BACKUP.ARCHIVE_REJECTED`-style 400 (message asserted loosely below, matching
 * the existing `/quota|storage limit/i`-style convention for not-yet-decided exact wording) as
 * soon as any of the following is exceeded, before any entry's `getData()` runs:
 *   - total entry count over `BACKUP_MAX_ZIP_ENTRIES`
 *   - running sum of declared uncompressed sizes over `BACKUP_MAX_UNCOMPRESSED_BYTES`
 *   - any single entry's `size / compressedSize` ratio over `BACKUP_MAX_COMPRESSION_RATIO`
 *
 * Tests override the env caps to small values (mirroring `authRateLimit.test.ts`'s
 * `AUTH_RATE_LIMIT_MAX` pattern) so the archives built here stay tiny and fast rather than
 * needing to construct a real multi-hundred-MB payload to exercise the limit.
 */

const buildZip = (entries: { name: string; data: Buffer }[]): Buffer => {
    const zip = new AdmZip()
    for (const entry of entries) {
        zip.addFile(entry.name, entry.data)
    }
    return zip.toBuffer()
}

const minimalBackupJsonEntry = () => ({
    name: 'spndr-backup.json',
    data: Buffer.from(
        JSON.stringify({
            version: 1,
            exportedAt: new Date().toISOString(),
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
        })
    ),
})

afterEach(() => {
    delete process.env.BACKUP_MAX_UNCOMPRESSED_BYTES
    delete process.env.BACKUP_MAX_ZIP_ENTRIES
    delete process.env.BACKUP_MAX_COMPRESSION_RATIO
})

describe('Zip-bomb protection on backup restore (S15, SEC-16)', () => {
    it('rejects an archive whose declared uncompressed size exceeds the configured cap', async () => {
        process.env.BACKUP_MAX_UNCOMPRESSED_BYTES = '1000'
        const { token } = await registerUser(app)

        const bombEntry = {
            name: 'spndr-backup.json',
            // Highly compressible: a 20,000-byte run of the same character compresses to
            // well under 1 KB, but its declared uncompressed size (20,000) exceeds the cap.
            data: Buffer.alloc(20_000, 'a'),
        }
        const zip = buildZip([bombEntry])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'bomb.zip')

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/large|size|uncompressed/i)
    })

    it('rejects an archive with more entries than the configured cap', async () => {
        process.env.BACKUP_MAX_ZIP_ENTRIES = '3'
        const { token } = await registerUser(app)

        const entries = Array.from({ length: 5 }, (_, i) => ({
            name: `receipts/file-${i}.txt`,
            data: Buffer.from(`entry ${i}`),
        }))
        const zip = buildZip([minimalBackupJsonEntry(), ...entries])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'many-entries.zip')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/entries|too many/i)
    })

    it('rejects an archive containing an entry with a suspicious compression ratio', async () => {
        process.env.BACKUP_MAX_COMPRESSION_RATIO = '5'
        // Keep this under the (unset, default) uncompressed-size cap so only the ratio check
        // is exercised: a large run of identical bytes compresses far beyond 5:1.
        const highRatioEntry = {
            name: 'spndr-backup.json',
            data: Buffer.alloc(500_000, 0),
        }
        const { token } = await registerUser(app)
        const zip = buildZip([highRatioEntry])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'ratio-bomb.zip')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/ratio|compression/i)
    })

    it('still restores a well-formed, small backup zip within all configured caps', async () => {
        process.env.BACKUP_MAX_UNCOMPRESSED_BYTES = '1000000'
        process.env.BACKUP_MAX_ZIP_ENTRIES = '50'
        process.env.BACKUP_MAX_COMPRESSION_RATIO = '1000'
        const { token } = await registerUser(app)
        const zip = buildZip([minimalBackupJsonEntry()])

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'ok.zip')

        expect(res.status).toBe(201)
    })
})
