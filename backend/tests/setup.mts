import { afterAll, afterEach } from 'vitest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

// Set synchronously (with the Mongo URI awaited) at module top level, not inside
// beforeAll: this setup file is imported and fully resolved before a test file's own
// top-level `import app from '../app'` runs, and createApp() now calls validateEnv()
// eagerly (SEC-12) — so these vars must already exist by the time that import executes,
// not merely by the time this file's beforeAll would otherwise have run. Top-level await
// requires this file to be ESM, hence the .mts extension (backend/package.json declares
// "type": "commonjs", so a plain .ts file here cannot use top-level await).
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-production'
process.env.JWT_EXPIRY = '1h'
process.env.JWT_REFRESH_EXPIRY = '7d'
process.env.CLIENT_URL = 'http://localhost:5173'
process.env.AUTH_RATE_LIMIT_MAX = '100'
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '900000'
process.env.VIRUS_SCAN_ENABLED = 'false'

const mongoServer = await MongoMemoryServer.create()
process.env.MONGO_URI = mongoServer.getUri()

await mongoose.connect(process.env.MONGO_URI)

afterEach(async () => {
    const collections = mongoose.connection.collections
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({})
    }
})

afterAll(async () => {
    await mongoose.disconnect()
    if (mongoServer) {
        await mongoServer.stop()
    }
})
