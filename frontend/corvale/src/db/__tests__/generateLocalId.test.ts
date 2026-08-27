import { describe, expect, it } from 'vitest'
import { generateLocalObjectId } from '../generateLocalId'

describe('generateLocalObjectId', () => {
  it('returns a 24-character lowercase hex string (valid mongoose ObjectId shape)', () => {
    const id = generateLocalObjectId()
    expect(id).toMatch(/^[0-9a-f]{24}$/)
  })

  it('generates distinct ids across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateLocalObjectId()))
    expect(ids.size).toBe(50)
  })
})
