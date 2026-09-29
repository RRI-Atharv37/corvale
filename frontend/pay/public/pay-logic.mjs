const CLIENT_TOKEN = /^(test|live)_[a-zA-Z0-9]{27}$/
const TRANSACTION_ID = /^txn_[a-z0-9]{20,40}$/
const ENVIRONMENT_FOR_PREFIX = { test: 'sandbox', live: 'production' }

export const INITIAL_VIEW = 'loading'

const clean = (value) => (typeof value === 'string' ? value.trim() : '')

const originOf = (value) => {
    try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.origin : null
    } catch {
        return null
    }
}

export const readConfig = (meta) => {
    const token = clean(meta('paddle-client-token'))
    const environment = clean(meta('paddle-environment'))
    const appUrl = originOf(clean(meta('corvale-app-url')))

    const match = CLIENT_TOKEN.exec(token)
    if (!match || !appUrl || ENVIRONMENT_FOR_PREFIX[match[1]] !== environment) return { ok: false }

    return { ok: true, token, environment, appUrl }
}

export const billingUrl = (appUrl) => `${appUrl}/settings/billing`

export const readTransactionId = (search) => {
    const values = new URLSearchParams(search).getAll('_ptxn')
    return values.length === 1 && TRANSACTION_ID.test(values[0]) ? values[0] : null
}

const VIEW_FOR_EVENT = {
    'checkout.loaded': 'paying',
    'checkout.completed': 'completed',
    'checkout.closed': 'closed',
    'checkout.error': 'error',
    'checkout.failed': 'error',
}

const FINAL_VIEWS = ['completed', 'invalid']

export const nextView = (current, eventName) => {
    if (FINAL_VIEWS.includes(current) || typeof eventName !== 'string') return current
    return VIEW_FOR_EVENT[eventName] ?? current
}
