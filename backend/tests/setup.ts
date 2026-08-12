import { beforeAll, afterAll, afterEach } from 'vitest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongoServer: MongoMemoryServer

beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-production'
    process.env.JWT_EXPIRY = '1h'
    process.env.JWT_REFRESH_EXPIRY = '7d'
    process.env.CLIENT_URL = 'http://localhost:5173'
    process.env.AUTH_RATE_LIMIT_MAX = '100'
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '900000'
    process.env.VIRUS_SCAN_ENABLED = 'false'

    mongoServer = await MongoMemoryServer.create()
    process.env.MONGO_URI = mongoServer.getUri()

    await mongoose.connect(process.env.MONGO_URI)
})

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
