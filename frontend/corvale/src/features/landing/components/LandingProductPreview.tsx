import React from 'react'

const TRANSACTIONS = [
    {
        title: 'Spotify',
        type: 'expense' as const,
        amount: '−$10.99',
        date: 'Today',
        category: 'Subscriptions',
    },
    {
        title: 'Dining',
        type: 'expense' as const,
        amount: '−$34.50',
        date: 'Yesterday',
        category: 'Food',
    },
    {
        title: 'Internship Paycheck',
        type: 'income' as const,
        amount: '+$680.00',
        date: 'Mon',
        category: 'Part-time',
    },
]

/**
 * Static product preview for the landing hero — mirrors the authenticated dashboard aesthetic.
 */
const LandingProductPreview: React.FC = () => {
    return (
        <div className="relative w-full max-w-lg mx-auto lg:mx-0 lg:ml-auto">
            <div
                className="pointer-events-none absolute -inset-6 rounded-2xl"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 0%, #9333ea22 0%, transparent 65%)',
                }}
                aria-hidden="true"
            />

            <div
                className="relative rounded-xl border border-border bg-surface-2 overflow-hidden"
                style={{
                    boxShadow:
                        '0 24px 48px color-mix(in srgb, #14121c 70%, transparent), 0 0 0 1px color-mix(in srgb, #a855f7 12%, transparent), 0 0 60px color-mix(in srgb, #9333ea 15%, transparent)',
                }}
            >
                <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3 bg-elevated">
                    <div className="flex gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-border" />
                        <span className="h-2.5 w-2.5 rounded-full bg-border" />
                        <span className="h-2.5 w-2.5 rounded-full bg-border" />
                    </div>
                    <span className="ml-2 text-xs text-text-secondary font-medium">Dashboard</span>
                </div>

                <div className="p-4 sm:p-5 space-y-4">
                    <div>
                        <p className="text-xs text-text-muted uppercase tracking-wide">Available balance</p>
                        <p className="font-mono-data text-3xl font-semibold text-text-primary mt-1">$1,847.32</p>
                        <p className="text-xs text-positive font-medium mt-1.5">+$420 net this month</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="stat-pill stat-pill--accent">
                            <p className="stat-pill__label">Income</p>
                            <p className="stat-pill__value">+$2,180</p>
                        </div>
                        <div className="stat-pill stat-pill--expense">
                            <p className="stat-pill__label">Expense</p>
                            <p className="stat-pill__value">−$1,760</p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border-subtle bg-elevated p-3">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-text-primary">Food & dining</p>
                            <p className="text-[10px] text-text-muted">$142 / $200</p>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-elevated-hover overflow-hidden">
                            <div
                                className="h-full rounded-full"
                                style={{
                                    width: '71%',
                                    background:
                                        'linear-gradient(90deg, var(--color-accent-start), var(--color-accent-end))',
                                }}
                            />
                        </div>
                        <div className="flex items-center justify-between mt-2">
                            <p className="text-[10px] text-text-muted">Entertainment</p>
                            <p className="text-[10px] text-warning font-medium">$89 / $75 · over</p>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-elevated-hover overflow-hidden mt-1">
                            <div className="h-full w-full rounded-full bg-negative/70" />
                        </div>
                    </div>

                    <div>
                        <p className="text-xs font-medium text-text-secondary mb-2">Recent transactions</p>
                        <ul className="space-y-2">
                            {TRANSACTIONS.map((tx) => (
                                <li
                                    key={tx.title}
                                    className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-elevated px-3 py-2.5"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="text-xs font-medium text-text-primary truncate">
                                                {tx.title}
                                            </p>
                                            <span
                                                className={[
                                                    'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0',
                                                    tx.type === 'income'
                                                        ? 'border-accent/30 text-accent'
                                                        : 'border-negative/30 text-negative',
                                                ].join(' ')}
                                            >
                                                {tx.type}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-text-muted mt-0.5">
                                            {tx.date} · {tx.category}
                                        </p>
                                    </div>
                                    <span
                                        className={`font-mono-data text-xs font-semibold shrink-0 ${
                                            tx.type === 'income' ? 'text-positive' : 'text-negative'
                                        }`}
                                    >
                                        {tx.amount}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default LandingProductPreview
