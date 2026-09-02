import { Router } from 'express'
import mongoose from 'mongoose'

const router = Router()

// Liveness: process is up. Does not touch Mongo, so it stays fast even if the DB is down.
router.get('/health', (_req, res) => {
    res.status(200).json({ success: true, data: { status: 'ok' } })
})

// Readiness: safe to receive traffic, i.e. the Mongo connection is actually up.
router.get('/ready', (_req, res) => {
    const isConnected = mongoose.connection.readyState === 1
    if (!isConnected) {
        res.status(503).json({ success: false, statusCode: 503, message: 'Service unavailable' })
        return
    }
    res.status(200).json({ success: true, data: { status: 'ready' } })
})

export default router
