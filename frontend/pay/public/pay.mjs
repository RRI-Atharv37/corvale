import { billingUrl, INITIAL_VIEW, nextView, readConfig, readTransactionId } from './pay-logic.mjs'

const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js'
const LOAD_TIMEOUT_MS = 20_000

const sections = [...document.querySelectorAll('[data-view]')]
let view = INITIAL_VIEW

const show = (next) => {
    view = next
    for (const section of sections) section.hidden = section.dataset.view !== next
}

const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null

const start = () => {
    const config = readConfig(meta)
    if (!config.ok) {
        console.error('Corvale checkout is not configured')
        show('invalid')
        return
    }
    if (readTransactionId(window.location.search) === null) {
        show('invalid')
        return
    }

    for (const link of document.querySelectorAll('[data-return-link]')) link.href = billingUrl(config.appUrl)

    const script = document.createElement('script')
    script.src = PADDLE_JS
    script.async = true
    script.onerror = () => show('error')
    script.onload = () => {
        const { Paddle } = window
        if (!Paddle) {
            show('error')
            return
        }
        if (config.environment === 'sandbox') Paddle.Environment.set('sandbox')
        Paddle.Initialize({ token: config.token, eventCallback: (event) => show(nextView(view, event?.name)) })
    }
    document.head.append(script)

    setTimeout(() => {
        if (view === INITIAL_VIEW) show('error')
    }, LOAD_TIMEOUT_MS)
}

start()
