import React, { useMemo } from 'react'
import type { RecurringRule, Transaction } from '../../types/api'
import { formatCurrency, toDateInputValue } from '../../utils/format'
import {
    buildCalendarGrid,
    projectRuleOccurrencesInMonth,
    ProjectedOccurrence,
    WEEKDAY_LABELS,
} from '../../utils/recurringUtils'

interface RecurringCalendarProps {
    year: number
    month: number
    rules: RecurringRule[]
    drafts: Transaction[]
    onPrevMonth: () => void
    onNextMonth: () => void
    onSelectDraft?: (draft: Transaction) => void
}

const RecurringCalendar: React.FC<RecurringCalendarProps> = ({
    year,
    month,
    rules,
    drafts,
    onPrevMonth,
    onNextMonth,
    onSelectDraft,
}) => {
    const today = toDateInputValue(new Date())

    const eventsByDate = useMemo(() => {
        const map = new Map<string, ProjectedOccurrence[]>()

        for (const rule of rules) {
            for (const occurrence of projectRuleOccurrencesInMonth(rule, year, month)) {
                const existing = map.get(occurrence.date) ?? []
                existing.push(occurrence)
                map.set(occurrence.date, existing)
            }
        }

        for (const draft of drafts) {
            const date = toDateInputValue(draft.date)
            const existing = map.get(date) ?? []
            existing.push({
                ruleId: draft.recurringPaymentId ?? draft._id,
                title: draft.title,
                type: draft.type === 'income' ? 'income' : 'expense',
                amount: draft.amount,
                currency: draft.currency,
                date,
                isDraft: true,
                transactionId: draft._id,
            })
            map.set(date, existing)
        }

        return map
    }, [rules, drafts, year, month])

    const cells = useMemo(() => buildCalendarGrid(year, month), [year, month])

    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    })

    return (
        <div className="card space-y-4">
            <div className="flex items-center justify-between gap-4">
                <button
                    type="button"
                    onClick={onPrevMonth}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
                >
                    Previous
                </button>
                <p className="text-sm font-medium text-slate-200">{monthLabel}</p>
                <button
                    type="button"
                    onClick={onNextMonth}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
                >
                    Next
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_LABELS.map((label) => (
                    <div
                        key={label}
                        className="text-center text-[11px] font-medium text-slate-500 py-1"
                    >
                        {label}
                    </div>
                ))}

                {cells.map((cell) => {
                    const events = eventsByDate.get(cell.date) ?? []
                    const isToday = cell.date === today

                    return (
                        <div
                            key={cell.date}
                            className={`min-h-[88px] rounded-lg border p-1.5 ${
                                cell.inMonth
                                    ? 'border-slate-800 bg-slate-900/30'
                                    : 'border-transparent bg-slate-950/40 opacity-50'
                            } ${isToday ? 'ring-1 ring-cyan-500/40' : ''}`}
                        >
                            <p
                                className={`text-[11px] font-medium mb-1 ${
                                    isToday ? 'text-cyan-300' : 'text-slate-400'
                                }`}
                            >
                                {cell.day}
                            </p>
                            <div className="space-y-0.5">
                                {events.slice(0, 3).map((event) => (
                                    <button
                                        key={`${event.ruleId}-${event.date}-${event.isDraft ? 'draft' : 'upcoming'}-${event.transactionId ?? ''}`}
                                        type="button"
                                        onClick={() => {
                                            if (event.isDraft && event.transactionId && onSelectDraft) {
                                                const draft = drafts.find(
                                                    (item) => item._id === event.transactionId
                                                )
                                                if (draft) onSelectDraft(draft)
                                            }
                                        }}
                                        className={`w-full text-left truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                                            event.isDraft
                                                ? 'bg-amber-500/15 text-amber-200 border border-amber-500/20'
                                                : event.type === 'income'
                                                  ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/15'
                                                  : 'bg-cyan-500/10 text-cyan-200 border border-cyan-500/15'
                                        } ${event.isDraft && onSelectDraft ? 'hover:bg-amber-500/25 cursor-pointer' : 'cursor-default'}`}
                                        title={`${event.title} · ${formatCurrency(event.amount, event.currency)}`}
                                    >
                                        {event.isDraft ? 'Draft: ' : ''}
                                        {event.title}
                                    </button>
                                ))}
                                {events.length > 3 && (
                                    <p className="text-[10px] text-slate-500 px-1">
                                        +{events.length - 3} more
                                    </p>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-1 border-t border-slate-800">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded bg-amber-500/30 border border-amber-500/30" />
                    Pending draft
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded bg-cyan-500/20 border border-cyan-500/20" />
                    Upcoming expense
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded bg-emerald-500/20 border border-emerald-500/20" />
                    Upcoming income
                </span>
            </div>
        </div>
    )
}

export default RecurringCalendar
