import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { RecurringRule } from '@features/recurring/types'
import type { Transaction } from '@features/transactions/types'
import { formatCurrency, formatDisplayDate, getCurrentMonthYear, toDateInputValue } from '@lib/format'
import {
    buildCalendarGrid,
    projectRuleOccurrencesInMonth,
    WEEKDAY_LABELS,
} from '@features/recurring/recurringUtils'

interface DashboardCalendarCardProps {
    rules: RecurringRule[]
    drafts: Transaction[]
}

const DashboardCalendarCard: React.FC<DashboardCalendarCardProps> = ({ rules, drafts }) => {
    const { year, month } = getCurrentMonthYear()
    const [viewYear, setViewYear] = useState(year)
    const [viewMonth, setViewMonth] = useState(month)
    const today = toDateInputValue(new Date())

    const eventsByDate = useMemo(() => {
        const map = new Map<string, number>()

        for (const rule of rules) {
            for (const occurrence of projectRuleOccurrencesInMonth(rule, viewYear, viewMonth)) {
                map.set(occurrence.date, (map.get(occurrence.date) ?? 0) + 1)
            }
        }

        for (const draft of drafts) {
            const date = toDateInputValue(draft.date)
            map.set(date, (map.get(date) ?? 0) + 1)
        }

        return map
    }, [rules, drafts, viewYear, viewMonth])

    const upcoming = useMemo(() => {
        const items: Array<{ date: string; title: string; amount: number; type: string }> = []

        for (const rule of rules.filter((r) => r.isActive && !r.isArchived)) {
            for (const occurrence of projectRuleOccurrencesInMonth(rule, viewYear, viewMonth)) {
                if (occurrence.date >= today) {
                    items.push({
                        date: occurrence.date,
                        title: occurrence.title,
                        amount: occurrence.amount,
                        type: occurrence.type,
                    })
                }
            }
        }

        return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
    }, [rules, viewYear, viewMonth, today])

    const cells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth])

    const monthLabel = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    })

    const shiftMonth = (delta: number) => {
        const date = new Date(Date.UTC(viewYear, viewMonth - 1 + delta, 1))
        setViewYear(date.getUTCFullYear())
        setViewMonth(date.getUTCMonth() + 1)
    }

    return (
        <div className="card space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-medium text-fg">Calendar</h3>
                    <p className="text-xs text-fg-muted mt-1">Recurring bills and upcoming drafts</p>
                </div>
                <Link
                    to="/recurring"
                    className="text-xs text-accent hover:text-accent transition-colors shrink-0"
                >
                    View all
                </Link>
            </div>

            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    className="px-2 py-1 text-xs rounded border border-border text-fg-muted hover:text-fg"
                >
                    Prev
                </button>
                <p className="text-xs font-medium text-fg-secondary">{monthLabel}</p>
                <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    className="px-2 py-1 text-xs rounded border border-border text-fg-muted hover:text-fg"
                >
                    Next
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
                {WEEKDAY_LABELS.map((label) => (
                    <div key={label} className="text-[10px] text-fg-muted py-1">
                        {label}
                    </div>
                ))}
                {cells.map((cell, index) => {
                    const count = cell.inMonth ? eventsByDate.get(cell.date) ?? 0 : 0
                    const isToday = cell.date === today
                    return (
                        <div
                            key={`${cell.date}-${index}`}
                            className={`aspect-square rounded-md flex flex-col items-center justify-center text-[10px] ${
                                cell.inMonth
                                    ? isToday
                                      ? 'bg-accent-subtle border border-accent/30 text-accent'
                                      : count > 0
                                        ? 'bg-accent-subtle/50 text-fg-secondary'
                                        : 'text-fg-muted'
                                    : 'text-text-quiet'
                            }`}
                        >
                            {cell.inMonth && <span>{cell.day}</span>}
                            {count > 0 && cell.inMonth && (
                                <span className="w-1 h-1 rounded-full bg-accent mt-0.5" />
                            )}
                        </div>
                    )
                })}
            </div>

            {upcoming.length > 0 ? (
                <ul className="divide-y divide-border-subtle">
                    {upcoming.map((item, index) => (
                        <li key={`${item.date}-${item.title}-${index}`} className="py-2 flex justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-xs text-fg truncate">{item.title}</p>
                                <p className="text-[10px] text-fg-muted">{formatDisplayDate(item.date)}</p>
                            </div>
                            <p
                                className={`text-xs shrink-0 ${
                                    item.type === 'income' ? 'text-income' : 'text-expense'
                                }`}
                            >
                                {formatCurrency(item.amount)}
                            </p>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-fg-muted text-center py-2">No upcoming recurring items.</p>
            )}
        </div>
    )
}

export default DashboardCalendarCard
