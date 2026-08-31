import { describe, it, expect } from 'vitest'
import type { Model } from 'mongoose'

import CategorizationRule from '../models/CategorizationRule'
import Notification from '../models/Notification'
import Receipt from '../models/Receipt'
import SavedReport from '../models/SavedReport'
import Saver from '../models/Saver'
import Tag from '../models/Tag'
import Transaction from '../models/Transaction'
import TransactionTemplate from '../models/TransactionTemplate'
import { TOMBSTONE_RETENTION_SECONDS } from '../utils/softDelete'

/**
 * SEC-47: `privacy.md` promises deletion markers are purged after the retention window. Before
 * this the only enforcement was the manual `npm run purge:tombstones` CLI, which nothing calls
 * on a schedule. A partial TTL index on `deletedAt` on every soft-deletable model makes the
 * database do it. These specs pin that the index exists, expires on the retention window, and is
 * partial so it never touches a live (deletedAt: null) row.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SOFT_DELETABLE_MODELS: Model<any>[] = [
    Transaction,
    Tag,
    Receipt,
    TransactionTemplate,
    CategorizationRule,
    SavedReport,
    Saver,
    Notification,
]

describe('SEC-47 — tombstone TTL index', () => {
    for (const model of SOFT_DELETABLE_MODELS) {
        it(`${model.modelName} has a partial TTL index on deletedAt`, async () => {
            await model.init()
            const indexes = await model.collection.indexes()

            const ttl = indexes.find((index) => index.name === 'tombstone_ttl')
            expect(ttl, `${model.modelName} is missing the tombstone_ttl index`).toBeDefined()

            expect(ttl?.key).toEqual({ deletedAt: 1 })
            expect(ttl?.expireAfterSeconds).toBe(TOMBSTONE_RETENTION_SECONDS)
            // Partial: live rows (deletedAt: null) are not indexed, so TTL only reaps tombstones.
            expect(ttl?.partialFilterExpression).toEqual({ deletedAt: { $type: 'date' } })
        })
    }

    it('retention window is 90 days', () => {
        expect(TOMBSTONE_RETENTION_SECONDS).toBe(90 * 24 * 60 * 60)
    })
})
