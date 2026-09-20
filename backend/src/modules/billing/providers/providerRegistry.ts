import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { logger } from '@infra/observability/logger'

import type { BillingProvider } from './billingProvider'
import { createMorProvider, morConfigFromEnv } from './morProvider'

const DEFAULT_PROVIDER = 'mor'

let installed: BillingProvider | null = null
let fromEnv: BillingProvider | null = null

const buildFromEnv = (): BillingProvider => {
    const name = (process.env.BILLING_PROVIDER ?? DEFAULT_PROVIDER).trim().toLowerCase()
    try {
        if (name === 'mor') return createMorProvider(morConfigFromEnv())
        throw new Error(`Unknown BILLING_PROVIDER "${name}"`)
    } catch (error) {
        logger.error('Billing provider is not configured', { reason: (error as Error).message })
        throw new CustomError(ERROR_MESSAGES.BILLING.PROVIDER_NOT_CONFIGURED, 500)
    }
}

export const getBillingProvider = (): BillingProvider => {
    if (installed) return installed
    fromEnv ??= buildFromEnv()
    return fromEnv
}

export const setBillingProvider = (provider: BillingProvider): void => {
    installed = provider
}

export const resetBillingProvider = (): void => {
    installed = null
    fromEnv = null
}
