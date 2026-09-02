import { describe, it, expect, vi } from 'vitest'
import type { Request, Response } from 'express'
import request from 'supertest'
import { createApp } from '@http/app'
import { errorHandler } from '@http/middleware/errorMiddleware'
import * as errorTracking from '@infra/observability/errorTracking'
import { authHeader, registerUser } from './helpers'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

/**
 * S35d — malformed client input must be a 4xx, never a 500 (no stack, no false Sentry incident).
 *   SEC-56: a malformed sync checkpoint.
 *   SEC-60: a malformed ObjectId in a path param.
 */

const encodeCheckpoint = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')

describe('SEC-56 — malformed sync checkpoint → 400', () => {
    it('rejects a checkpoint that is not valid base64url/JSON', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const res = await request(app)
            .get('/api/v1/sync/pull')
            .query({ checkpoint: 'not@@base64!!{{' })
            .set(authHeader(token))

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
    })

    it('rejects a well-formed checkpoint carrying a garbage cursor id / date (used to be a 500)', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const badCursor = encodeCheckpoint({
            cursors: { transaction: { id: 'not-an-objectid', updatedAt: 'not-a-date' } },
        })

        const res = await request(app)
            .get('/api/v1/sync/pull')
            .query({ checkpoint: badCursor })
            .set(authHeader(token))

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
    })

    it('still accepts an empty checkpoint and a well-formed one', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const first = await request(app).get('/api/v1/sync/pull').query({ checkpoint: '' }).set(authHeader(token))
        expect(first.status).toBe(200)

        const roundTrip = await request(app)
            .get('/api/v1/sync/pull')
            .query({ checkpoint: first.body.data.checkpoint })
            .set(authHeader(token))
        expect(roundTrip.status).toBe(200)
    })
})

describe('SEC-60 — malformed ObjectId path param → 4xx, not 500', () => {
    it('validateResourceAccess collapses a non-ObjectId id into the not-found response (404)', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const get = await request(app)
            .get('/api/v1/transactions/not-a-valid-object-id')
            .set(authHeader(token))
        expect(get.status).toBe(404)
        expect(get.body.message).toBe(ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND)

        const del = await request(app)
            .delete('/api/v1/transactions/xyz')
            .set(authHeader(token))
        expect(del.status).toBe(404)
    })

    it('the errorMiddleware CastError backstop turns any other malformed-id path into a 400', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        // getTagById → validateUserTag → Tag.findById(<bad id>) — no pre-validation there, so the
        // Mongoose CastError has to be caught centrally.
        const res = await request(app)
            .get('/api/v1/tags/not-a-valid-object-id')
            .set(authHeader(token))

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toBe(ERROR_MESSAGES.GENERAL.INVALID_IDENTIFIER)
    })

    it('errorHandler maps a Mongoose CastError to 400 and skips error tracking', () => {
        const capture = vi.spyOn(errorTracking, 'captureException').mockImplementation(() => {})

        const castError = Object.assign(new Error('Cast to ObjectId failed for value "x"'), {
            name: 'CastError',
        })
        const json = vi.fn()
        const res = { status: vi.fn().mockReturnThis(), json } as unknown as Response
        const req = { path: '/api/v1/anything/x', method: 'GET' } as unknown as Request

        errorHandler(castError, req, res, vi.fn())

        expect(res.status).toHaveBeenCalledWith(400)
        expect(json.mock.calls[0][0]).toMatchObject({
            success: false,
            statusCode: 400,
            message: ERROR_MESSAGES.GENERAL.INVALID_IDENTIFIER,
        })
        expect(capture).not.toHaveBeenCalled()
        capture.mockRestore()
    })

    it('a well-formed but non-existent id still 404s (regression)', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const res = await request(app)
            .get('/api/v1/transactions/6a95f8deee61fdb33564f1e0')
            .set(authHeader(token))
        expect(res.status).toBe(404)
    })
})
