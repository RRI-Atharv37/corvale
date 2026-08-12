import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorHandler } from '../middleware/errorMiddleware'
import { CustomError } from '../utils/customError'

const createErrorTestApp = (): express.Application => {
    const app = express()
    app.get('/api/v1/__test/error', (_req, _res, next) => {
        next(new CustomError('Sensitive failure detail', 400))
    })
    app.use(errorHandler)
    return app
}

describe('Production hardening', () => {
    afterEach(() => {
        process.env.NODE_ENV = 'test'
    })

    it('omits stack traces from error responses when NODE_ENV=production', async () => {
        process.env.NODE_ENV = 'production'

        const app = createErrorTestApp()
        const res = await request(app).get('/api/v1/__test/error')

        expect(res.status).toBe(400)
        expect(res.body.message).toBe('Sensitive failure detail')
        expect(res.body.stack).toBeNull()
    })

    it('includes stack traces in non-production error responses', async () => {
        process.env.NODE_ENV = 'development'

        const app = createErrorTestApp()
        const res = await request(app).get('/api/v1/__test/error')

        expect(res.status).toBe(400)
        expect(res.body.stack).toBeTruthy()
    })
})
