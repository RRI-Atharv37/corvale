/** Shared copy — keep headlines, ads, and in-app messaging aligned. */
export const BRAND = {
    name: 'spndr',
    tagline: 'Stop guessing. Start knowing.',
    headline: 'Know where every dollar went',
    audience: 'Students and young adults with irregular income',
    adHook: 'Your balance dropped $800. Name one purchase.',
    cta: 'Start tracking free',
    ctaSecondary: 'See how it works',
} as const

export const AUTHOR = {
    name: 'Atharv Dewangan',
    github: 'https://github.com/RRI-Atharv37',
} as const

export const PAIN_POINTS = [
    {
        title: 'Balance shock',
        scenario: 'You open your banking app and you\'re $847 lower than you expected.',
        consequence:
            'No single purchase explains it — just coffee, delivery, subscriptions, and "small things" that quietly add up to rent money.',
        stat: '$847',
        statLabel: 'unaccounted for',
    },
    {
        title: 'Rent-week panic',
        scenario: 'Rent is due in four days. Your paycheck hit checking, but half already moved to Venmo and a savings app you forgot about.',
        consequence:
            'You\'re doing math in your head at 11pm instead of sleeping — and still not sure if you\'ll overdraft.',
        stat: '4 days',
        statLabel: 'until rent',
    },
] as const

export const FEATURES = [
    {
        title: 'Track every transaction',
        description: 'Log income and spending in one place — no more reconstructing the month from three apps.',
    },
    {
        title: 'Set budgets that stick',
        description: 'Category limits with real numbers, not a spreadsheet you abandoned in week two.',
    },
    {
        title: 'Save toward goals',
        description: 'Name what you\'re saving for and watch progress instead of hoping something\'s left at month-end.',
    },
    {
        title: 'See where it goes',
        description: 'Reports and charts that answer "where did my money go?" in seconds, not hours.',
    },
] as const

export const STEPS = [
    {
        step: 'Log',
        description: 'Add transactions as they happen — takes ten seconds on your phone.',
    },
    {
        step: 'Budget',
        description: 'Set limits for food, fun, and bills based on what you actually earn.',
    },
    {
        step: 'Know',
        description: 'Check your dashboard before you swipe — not after the damage is done.',
    },
] as const

export const TESTIMONIALS = [
    {
        quote: 'I finally know why my checking account dies mid-month. Turns out "just DoorDash" was $340.',
        name: 'Maya R.',
        detail: 'Junior, UC San Diego',
    },
    {
        quote: 'Rent week used to wreck me. Now I see exactly what\'s left before I say yes to plans.',
        name: 'Jordan K.',
        detail: 'First job, Austin',
    },
    {
        quote: 'I stopped using a spreadsheet I\'d update once. spndr is the first thing I actually open.',
        name: 'Alex T.',
        detail: 'Grad student, Chicago',
    },
] as const
