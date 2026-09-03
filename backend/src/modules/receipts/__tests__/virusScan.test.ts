import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Receipt } from '@modules/receipts'
import { authHeader, registerUser } from '@tests/helpers'
import {
    isVirusScanEnabled,
    setVirusScanHandlerForTests,
} from '@infra/security/virusScanService'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { RECEIPT_UPLOAD_ROOT } from "@modules/receipts/receiptUtils";

const FIXTURE_PNG = path.join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'sample-receipt.png')

describe('Receipt virus scan', () => {
    beforeEach(() => {
        process.env.VIRUS_SCAN_ENABLED = 'true'
        process.env.VIRUS_SCAN_FAIL_CLOSED = 'true'
    })

    afterEach(() => {
        process.env.VIRUS_SCAN_ENABLED = 'false'
        process.env.VIRUS_SCAN_FAIL_CLOSED = 'true'
        setVirusScanHandlerForTests(null)

        if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
            fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
        }
    })

    it('skips scanning when VIRUS_SCAN_ENABLED is false', () => {
        process.env.VIRUS_SCAN_ENABLED = 'false'
        expect(isVirusScanEnabled()).toBe(false)
    })

    it('allows clean uploads when the scanner passes the file', async () => {
        setVirusScanHandlerForTests(async () => 'clean')

        const { token } = await registerUser(app, { email: 'virus-clean@example.com' })

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(201)

        const receipt = await Receipt.findById(res.body.data._id)
        expect(receipt).not.toBeNull()
    })

    it('rejects infected uploads and does not persist receipt metadata', async () => {
        setVirusScanHandlerForTests(async () => 'infected')

        const { token, userId } = await registerUser(app, { email: 'virus-infected@example.com' })

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.RECEIPT.VIRUS_DETECTED)

        const receipts = await Receipt.find({ userId })
        expect(receipts).toHaveLength(0)

        const userDir = path.join(RECEIPT_UPLOAD_ROOT, userId)
        if (fs.existsSync(userDir)) {
            expect(fs.readdirSync(userDir)).toHaveLength(0)
        }
    })

    it('rejects uploads when fail-closed scanning errors', async () => {
        setVirusScanHandlerForTests(async () => {
            throw new Error('scanner unavailable')
        })

        const { token } = await registerUser(app, { email: 'virus-fail-closed@example.com' })

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(503)
        expect(res.body.message).toBe(ERROR_MESSAGES.RECEIPT.VIRUS_SCAN_FAILED)
    })

    it('allows uploads when fail-open scanning errors', async () => {
        process.env.VIRUS_SCAN_FAIL_CLOSED = 'false'
        setVirusScanHandlerForTests(async () => {
            throw new Error('scanner unavailable')
        })

        const { token } = await registerUser(app, { email: 'virus-fail-open@example.com' })

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(201)
    })
})
