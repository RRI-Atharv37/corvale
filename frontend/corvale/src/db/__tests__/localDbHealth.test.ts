import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalDbDamageReason,
  getLocalDbHealth,
  markLocalDbDamaged,
  markLocalDbHealthy,
  resetLocalDbHealthForTests,
  subscribeLocalDbHealth,
} from '../localDbHealth'

describe('localDbHealth (BUG-30)', () => {
  beforeEach(() => {
    resetLocalDbHealthForTests()
  })

  it('starts healthy with no damage reason', () => {
    expect(getLocalDbHealth()).toBe('ok')
    expect(getLocalDbDamageReason()).toBeNull()
  })

  it('records the reason when marked damaged and notifies subscribers', () => {
    const listener = vi.fn()
    subscribeLocalDbHealth(listener)

    markLocalDbDamaged('SQLCipher: file is not a database')

    expect(getLocalDbHealth()).toBe('damaged')
    expect(getLocalDbDamageReason()).toBe('SQLCipher: file is not a database')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('clears the damage state and notifies when marked healthy again', () => {
    const listener = vi.fn()
    markLocalDbDamaged('boom')
    subscribeLocalDbHealth(listener)

    markLocalDbHealthy()

    expect(getLocalDbHealth()).toBe('ok')
    expect(getLocalDbDamageReason()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not notify when marked healthy while already healthy', () => {
    const listener = vi.fn()
    subscribeLocalDbHealth(listener)

    markLocalDbHealthy()

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLocalDbHealth(listener)

    unsubscribe()
    markLocalDbDamaged('boom')

    expect(listener).not.toHaveBeenCalled()
  })
})
