import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'

import { errorHandler } from '@http/middleware/errorMiddleware'
import { setErrorTrackingClient } from '@infra/observability/errorTracking'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { Transaction } from '@modules/transactions'

/**
 * SEC-96 - a Mongoose `ValidationError` is a client-input failure. It used to fall through to a 500
 * and be reported, with the rejected value inside the message, contra `privacy.md` ("a validation
 * failure ... is never reported").
 */

const reported: unknown[] = []

afterEach(() => {
    setErrorTrackingClient(null)
    reported.length = 0
})

const appThrowing = (error: Error) => {
    const server = express()
    server.get('/boom', () => {
        throw error
    })
    server.use(errorHandler)
    return server
}

const captureReports = () => setErrorTrackingClient({ captureException: (err) => void reported.push(err) })

const buildValidationError = async (): Promise<Error> => {
    const doc = new Transaction({ amount: 'not-a-number-secret-value' })
    const error = await doc.validate().then(
        () => null,
        (e: Error) => e
    )
    if (!error) throw new Error('expected a validation error')
    return error
}

describe('errorHandler and Mongoose validation errors (SEC-96)', () => {
    it('answers 400 with a generic message that carries none of the rejected values', async () => {
        captureReports()
        const error = await buildValidationError()
        expect(error).toBeInstanceOf(mongoose.Error.ValidationError)

        const res = await request(appThrowing(error)).get('/boom')

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toBe(ERROR_MESSAGES.GENERAL.INVALID_INPUT)
        expect(JSON.stringify(res.body)).not.toContain('not-a-number-secret-value')
    })

    it('does not report it to error tracking', async () => {
        captureReports()

        await request(appThrowing(await buildValidationError())).get('/boom')

        expect(reported).toHaveLength(0)
    })

    it('treats a standalone Mongoose CastError for a value as a 400 that is not reported', async () => {
        captureReports()
        const cast = new mongoose.Error.CastError('date', 'Invalid Date', 'clearedAt')

        const res = await request(appThrowing(cast)).get('/boom')

        expect(res.status).toBe(400)
        expect(reported).toHaveLength(0)
    })

    it('still reports an unexpected failure as a 500', async () => {
        captureReports()

        const res = await request(appThrowing(new Error('database exploded'))).get('/boom')

        expect(res.status).toBe(500)
        expect(res.body.message).toBe('Internal Server Error')
        expect(reported).toHaveLength(1)
    })
})
