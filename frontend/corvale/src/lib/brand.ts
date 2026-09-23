/** Shared copy - keep headlines, ads, and in-app messaging aligned. */
export const BRAND = {
    name: 'Corvale',
    tagline: 'Yours to leave, anytime.',
    headline: 'Offline-first. Self-hosted. Yours to leave',
    audience: 'For people done handing banks and budget apps their data',
    adHook: 'No bank login. No cloud lock-in. No subscription holding your ledger hostage.',
    cta: 'Start tracking free',
    ctaSecondary: 'See how it works',
} as const

export const AUTHOR = {
    name: 'Atharv Dewangan',
    github: 'https://github.com/RRI-Atharv37',
} as const

export const PAIN_POINTS = [
    {
        title: 'The app you trusted disappears',
        scenario: 'Mint shut down overnight and took years of spending history with it. Every "free" budgeting app runs on someone else\'s roadmap, not yours.',
        consequence:
            'Your financial history should outlive a company\'s pivot, acquisition, or shutdown decision - not depend on it.',
        stat: '0',
        statLabel: 'notice you get when they sunset it',
    },
    {
        title: 'Your bank login, copied five times',
        scenario: 'Every aggregator-based tracker asks for your real bank credentials or a broker connection just to show you a chart.',
        consequence:
            'Corvale never asks for a bank login. You import a statement, or you type it in - the data stays on your device unless you choose to sync it.',
        stat: '0',
        statLabel: 'bank credentials stored',
    },
] as const

export const FEATURES = [
    {
        title: 'Works fully offline',
        description: 'A real local-first engine - not a cache. Add transactions, check budgets, and see reports with no connection at all, on desktop or in the browser.',
    },
    {
        title: 'Self-host it, or don\'t',
        description: 'AGPL-licensed and Docker-deployable. Run it on your own server if you want total control, or use the hosted version - same codebase, your call.',
    },
    {
        title: 'Export everything, always',
        description: 'Full JSON or ZIP backup on every plan, including if you stop paying. Your ledger is a file you own, not a hostage.',
    },
    {
        title: 'No bank connection required',
        description: 'Import CSV/OFX/QIF statements or log transactions by hand. Nothing ever asks for your online banking password.',
    },
] as const

export const STEPS = [
    {
        step: 'Log',
        description: 'Add transactions as they happen - on your phone, your desktop, or with no signal at all.',
    },
    {
        step: 'Budget',
        description: 'Set limits for food, fun, and bills based on what you actually earn.',
    },
    {
        step: 'Own it',
        description: 'Your data lives on your device first and syncs on your terms - export it whenever, keep it forever.',
    },
] as const
