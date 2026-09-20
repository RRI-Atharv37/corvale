import { afterEach, describe, expect, it } from 'vitest'

import {
    assertBillingConfigured,
    getBillingProvider,
    resetBillingProvider,
    setBillingProvider,
    type BillingProvider,
} from '@modules/billing'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { createFakeBillingProvider } from '../fakeBillingProvider'

const ENV_KEYS = [
    'BILLING_PROVIDER',
    'MOR_API_KEY',
    'MOR_STORE_ID',
    'MOR_WEBHOOK_SECRET',
    'MOR_VARIANTS',
] as const

const saved = Object.fromEntries([...ENV_KEYS, 'BILLING_ENABLED'].map((key) => [key, process.env[key]]))

const configureMor = (): void => {
    process.env.MOR_API_KEY = 'mor_key'
    process.env.MOR_STORE_ID = '9'
    process.env.MOR_WEBHOOK_SECRET = 'mor_secret'
    process.env.MOR_VARIANTS = JSON.stringify({
        plus: { monthly: '101', annual: '102' },
        pro: { monthly: '201', annual: '202' },
    })
}

afterEach(() => {
    resetBillingProvider()
    for (const key of [...ENV_KEYS, 'BILLING_ENABLED']) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
    }
})

describe('getBillingProvider', () => {
    it('returns the provider installed with setBillingProvider', () => {
        const { provider } = createFakeBillingProvider()
        setBillingProvider(provider)

        expect(getBillingProvider()).toBe(provider)
    })

    it('resetBillingProvider drops the installed provider', () => {
        const { provider } = createFakeBillingProvider()
        setBillingProvider(provider)
        resetBillingProvider()
        for (const key of ENV_KEYS) delete process.env[key]

        expect(() => getBillingProvider()).toThrow(CustomError)
    })

    it('builds the MoR adapter from the environment by default', () => {
        configureMor()

        const provider: BillingProvider = getBillingProvider()

        expect(provider.name).toBe('mor')
    })

    it('memoises the environment-built provider', () => {
        configureMor()

        expect(getBillingProvider()).toBe(getBillingProvider())
    })

    it('honours BILLING_PROVIDER=mor explicitly', () => {
        configureMor()
        process.env.BILLING_PROVIDER = 'mor'

        expect(getBillingProvider().name).toBe('mor')
    })

    it('refuses to build the fake from the environment', () => {
        configureMor()
        process.env.BILLING_PROVIDER = 'fake'

        expect(() => getBillingProvider()).toThrow(CustomError)
    })

    it('rejects an unknown BILLING_PROVIDER with a generic 500 that names no setting', () => {
        process.env.BILLING_PROVIDER = 'stripe'

        let thrown: unknown
        try {
            getBillingProvider()
        } catch (error) {
            thrown = error
        }

        expect(thrown).toBeInstanceOf(CustomError)
        expect((thrown as CustomError).statusCode).toBe(500)
        expect((thrown as CustomError).message).toBe(ERROR_MESSAGES.BILLING.PROVIDER_NOT_CONFIGURED)
    })

    it('a missing setting surfaces as the generic not-configured error, not the variable names', () => {
        for (const key of ENV_KEYS) delete process.env[key]

        let thrown: unknown
        try {
            getBillingProvider()
        } catch (error) {
            thrown = error
        }

        expect(thrown).toBeInstanceOf(CustomError)
        expect((thrown as CustomError).statusCode).toBe(500)
        expect((thrown as CustomError).message).toBe(ERROR_MESSAGES.BILLING.PROVIDER_NOT_CONFIGURED)
        expect((thrown as CustomError).message).not.toContain('MOR_')
    })

    it('does not cache a failed build', () => {
        for (const key of ENV_KEYS) delete process.env[key]
        expect(() => getBillingProvider()).toThrow(CustomError)

        configureMor()

        expect(getBillingProvider().name).toBe('mor')
    })
})

describe('assertBillingConfigured (boot fail-fast)', () => {
    it('does nothing while billing is off, whatever is or is not configured', () => {
        delete process.env.BILLING_ENABLED
        for (const key of ENV_KEYS) delete process.env[key]

        expect(() => assertBillingConfigured()).not.toThrow()
    })

    it('does nothing when billing is on and the provider is fully configured', () => {
        process.env.BILLING_ENABLED = 'true'
        configureMor()

        expect(() => assertBillingConfigured()).not.toThrow()
    })

    it('throws at boot when billing is on and a provider setting is missing, naming the setting', () => {
        process.env.BILLING_ENABLED = 'true'
        configureMor()
        delete process.env.MOR_WEBHOOK_SECRET

        expect(() => assertBillingConfigured()).toThrow(/MOR_WEBHOOK_SECRET/)
    })

    it('throws at boot when billing is on and the provider name is unknown', () => {
        process.env.BILLING_ENABLED = 'true'
        configureMor()
        process.env.BILLING_PROVIDER = 'stripe'

        expect(() => assertBillingConfigured()).toThrow(/BILLING_PROVIDER/)
    })

    it('checks the environment, not an installed test provider', () => {
        process.env.BILLING_ENABLED = 'true'
        for (const key of ENV_KEYS) delete process.env[key]
        setBillingProvider(createFakeBillingProvider().provider)

        expect(() => assertBillingConfigured()).toThrow()
    })
})
