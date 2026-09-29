import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { billingUrl, INITIAL_VIEW, nextView, readConfig, readTransactionId } from '../public/pay-logic.mjs'

const SANDBOX_TOKEN = `test_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N'}`
const LIVE_TOKEN = `live_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N'}`
const APP_URL = 'https://corvale.app'

const metas = (values) => (name) => (name in values ? values[name] : null)
const full = (overrides = {}) => ({
    'paddle-client-token': SANDBOX_TOKEN,
    'paddle-environment': 'sandbox',
    'corvale-app-url': APP_URL,
    ...overrides,
})

describe('readConfig', () => {
    it('accepts a sandbox token with the sandbox environment', () => {
        assert.deepEqual(readConfig(metas(full())), {
            ok: true,
            token: SANDBOX_TOKEN,
            environment: 'sandbox',
            appUrl: 'https://corvale.app',
        })
    })

    it('accepts a live token with the production environment', () => {
        const config = readConfig(metas(full({ 'paddle-client-token': LIVE_TOKEN, 'paddle-environment': 'production' })))

        assert.equal(config.ok, true)
        assert.equal(config.environment, 'production')
    })

    it('trims whitespace a template can leave around a value', () => {
        const config = readConfig(metas(full({ 'paddle-client-token': `  ${SANDBOX_TOKEN}\n`, 'paddle-environment': ' sandbox ' })))

        assert.equal(config.ok, true)
    })

    it('reduces the app url to its origin, dropping any path, query or fragment', () => {
        const config = readConfig(metas(full({ 'corvale-app-url': 'https://corvale.app/some/path?x=1#y' })))

        assert.equal(config.appUrl, 'https://corvale.app')
    })

    it('fails closed when a setting is missing or empty', () => {
        for (const name of ['paddle-client-token', 'paddle-environment', 'corvale-app-url']) {
            assert.equal(readConfig(metas(full({ [name]: '' }))).ok, false, `${name} empty`)
            assert.equal(readConfig(metas(full({ [name]: undefined }))).ok, false, `${name} undefined`)
            const without = full()
            delete without[name]
            assert.equal(readConfig(metas(without)).ok, false, `${name} absent`)
        }
    })

    it('fails closed on a template placeholder the server never rendered', () => {
        assert.equal(readConfig(metas(full({ 'paddle-client-token': '{{env "PADDLE_CLIENT_TOKEN"}}' }))).ok, false)
        assert.equal(readConfig(metas(full({ 'corvale-app-url': '{{env "CORVALE_APP_URL"}}' }))).ok, false)
    })

    for (const [label, token] of [
        ['a server-side API key', 'pdl_live_apikey_01hv8wptq8987qeep44cyrewp9'],
        ['a webhook secret', 'pdl_ntfset_01hv8wptq8987qeep44cyrewp9_abc123'],
        ['a token that is too short', 'test_abc123'],
        ['a token that is too long', `test_${'a'.repeat(28)}`],
        ['a token with a stray character', `test_${'a'.repeat(26)}-`],
        ['a token with no test/live prefix', `prod_${'a'.repeat(27)}`],
    ]) {
        it(`rejects ${label}, so a secret pasted into the wrong setting is never sent to the browser`, () => {
            assert.equal(readConfig(metas(full({ 'paddle-client-token': token }))).ok, false)
        })
    }

    it('rejects a live token with the sandbox environment and a test token with production', () => {
        assert.equal(readConfig(metas(full({ 'paddle-client-token': LIVE_TOKEN }))).ok, false)
        assert.equal(readConfig(metas(full({ 'paddle-environment': 'production' }))).ok, false)
    })

    it('rejects an unknown environment', () => {
        assert.equal(readConfig(metas(full({ 'paddle-environment': 'staging' }))).ok, false)
    })

    for (const [label, url] of [
        ['a plain-http url', 'http://corvale.app'],
        ['a javascript: url', 'javascript:alert(1)'],
        ['a data: url', 'data:text/html,hi'],
        ['something that is not a url', 'not a url'],
        ['a url carrying credentials', 'https://user:pass@corvale.app'],
    ]) {
        it(`rejects ${label} as the app url`, () => {
            assert.equal(readConfig(metas(full({ 'corvale-app-url': url }))).ok, false)
        })
    }
})

describe('billingUrl', () => {
    it('points at the billing page of the app', () => {
        assert.equal(billingUrl('https://corvale.app'), 'https://corvale.app/settings/billing')
    })
})

describe('readTransactionId', () => {
    const ID = 'txn_01hv8wptq8987qeep44cyrewp9'

    it('reads a well-formed transaction id from _ptxn', () => {
        assert.equal(readTransactionId(`?_ptxn=${ID}`), ID)
    })

    it('ignores other parameters', () => {
        assert.equal(readTransactionId(`?utm=x&_ptxn=${ID}&y=1`), ID)
    })

    for (const [label, search] of [
        ['no query', ''],
        ['no _ptxn', '?a=b'],
        ['an empty _ptxn', '?_ptxn='],
        ['the wrong id kind', '?_ptxn=pri_01hv8wptq8987qeep44cyrewp9'],
        ['a too-short id', '?_ptxn=txn_abc'],
        ['an uppercase id', `?_ptxn=${ID.toUpperCase()}`],
        ['markup in the id', '?_ptxn=txn_%3Cscript%3Ealert(1)%3C%2Fscript%3Eaaaaaaaaaaaa'],
        ['a repeated _ptxn', `?_ptxn=${ID}&_ptxn=${ID}`],
        ['trailing junk', `?_ptxn=${ID}%20x`],
    ]) {
        it(`returns null for ${label}`, () => {
            assert.equal(readTransactionId(search), null)
        })
    }
})

describe('nextView', () => {
    it('starts on the loading view', () => {
        assert.equal(INITIAL_VIEW, 'loading')
    })

    it('follows the checkout through loaded, completed and closed', () => {
        assert.equal(nextView('loading', 'checkout.loaded'), 'paying')
        assert.equal(nextView('paying', 'checkout.completed'), 'completed')
    })

    it('shows the closed view when the customer closes the checkout without paying', () => {
        assert.equal(nextView('paying', 'checkout.closed'), 'closed')
        assert.equal(nextView('loading', 'checkout.closed'), 'closed')
    })

    it('never leaves the completed view: a close or an error after payment is not a failure', () => {
        assert.equal(nextView('completed', 'checkout.closed'), 'completed')
        assert.equal(nextView('completed', 'checkout.error'), 'completed')
        assert.equal(nextView('completed', 'checkout.loaded'), 'completed')
    })

    for (const name of ['checkout.error', 'checkout.failed']) {
        it(`shows the error view on ${name}`, () => {
            assert.equal(nextView('paying', name), 'error')
        })
    }

    it('leaves the view alone for an event it does not know, or a non-string one', () => {
        assert.equal(nextView('paying', 'checkout.customer.created'), 'paying')
        assert.equal(nextView('paying', undefined), 'paying')
        assert.equal(nextView('paying', { name: 'checkout.completed' }), 'paying')
    })

    it('does not get stuck on an unrecoverable configuration view', () => {
        assert.equal(nextView('invalid', 'checkout.completed'), 'invalid')
    })
})
