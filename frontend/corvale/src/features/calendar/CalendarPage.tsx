import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IoChevronBack, IoChevronForward } from 'react-icons/io5'
import PageHeader from '@ui/PageHeader'
import AsyncContent from '@ui/AsyncContent'
import { useWorkspace } from '@/app/providers/useWorkspace'
import WorkspaceReadOnlyBanner from '@features/workspaces/components/WorkspaceReadOnlyBanner'
import { useCalendarData } from './hooks/useCalendarData'
import type { CalendarEvent, CalendarEventType } from '@lib/types/api'
import { formatCurrency, toDateInputValue } from '@lib/format'
import { buildCalendarGrid, WEEKDAY_LABELS } from '@features/recurring/recurringUtils'

const EVENT_STYLES: Record<CalendarEventType, { label: string; className: string; to: string }> = {
    recurring: {
        label: 'Bill',
        className: 'bg-accent-subtle text-accent border border-accent/30',
        to: '/recurring',
    },
    budget_end: {
        label: 'Budget ends',
        className: 'bg-warning/10 text-warning border border-warning/30',
        to: '/budgets',
    },
    goal_deadline: {
        label: 'Goal deadline',
        className: 'bg-income/10 text-income border border-income/30',
        to: '/savings-goals',
    },
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

const CalendarPage: React.FC = () => {
    const { activeWorkspace, isPersonal } = useWorkspace()
    const [cursor, setCursor] = useState(() => {
        const now = new Date()
        return { year: now.getFullYear(), month: now.getMonth() + 1 }
    })

    const cells = useMemo(() => buildCalendarGrid(cursor.year, cursor.month), [cursor])
    const rangeStart = cells[0]?.date ?? toDateInputValue(new Date())
    const rangeEnd = cells[cells.length - 1]?.date ?? rangeStart

    const { events, loading, error, refetch } = useCalendarData(rangeStart, rangeEnd)

    const eventsByDate = useMemo(() => {
        const map = new Map<string, CalendarEvent[]>()
        for (const event of events ?? []) {
            const list = map.get(event.date) ?? []
            list.push(event)
            map.set(event.date, list)
        }
        return map
    }, [events])

    const goToPreviousMonth = () => {
        setCursor((prev) => {
            const month = prev.month === 1 ? 12 : prev.month - 1
            const year = prev.month === 1 ? prev.year - 1 : prev.year
            return { year, month }
        })
    }

    const goToNextMonth = () => {
        setCursor((prev) => {
            const month = prev.month === 12 ? 1 : prev.month + 1
            const year = prev.month === 12 ? prev.year + 1 : prev.year
            return { year, month }
        })
    }

    const goToToday = () => {
        const now = new Date()
        setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 })
    }

    const monthLabel = MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(cursor.year, cursor.month - 1, 1)))
    const todayStr = toDateInputValue(new Date())

    return (
        <div>
            <PageHeader
                title="Financial calendar"
                description={
                    isPersonal
                        ? 'Bills, budget period ends, and savings goal deadlines in one place'
                        : `Calendar for ${activeWorkspace?.name ?? 'workspace'}`
                }
            />

            <WorkspaceReadOnlyBanner />

            <div className="flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={goToPreviousMonth}
                        className="p-2 rounded-lg border border-border-subtle text-fg-muted hover:border-border hover:text-fg transition-colors"
                        aria-label="Previous month"
                    >
                        <IoChevronBack size={16} />
                    </button>
                    <p className="text-sm font-medium text-fg w-40 text-center">{monthLabel}</p>
                    <button
                        type="button"
                        onClick={goToNextMonth}
                        className="p-2 rounded-lg border border-border-subtle text-fg-muted hover:border-border hover:text-fg transition-colors"
                        aria-label="Next month"
                    >
                        <IoChevronForward size={16} />
                    </button>
                </div>
                <button
                    type="button"
                    onClick={goToToday}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border-subtle text-fg-muted hover:border-border hover:text-fg transition-colors"
                >
                    Today
                </button>
            </div>

            <AsyncContent
                loading={loading}
                error={error}
                data={events}
                isEmpty={() => false}
                loadingMessage="Loading calendar..."
                emptyTitle="Nothing scheduled"
                onRetry={refetch}
            >
                {() => (
                    <div className="card overflow-hidden p-0">
                        <div className="grid grid-cols-7 border-b border-border-subtle">
                            {WEEKDAY_LABELS.map((label) => (
                                <div
                                    key={label}
                                    className="px-2 py-2 text-center text-[11px] font-medium text-fg-muted"
                                >
                                    {label}
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7">
                            {cells.map((cell) => {
                                const dayEvents = eventsByDate.get(cell.date) ?? []
                                const isToday = cell.date === todayStr
                                return (
                                    <div
                                        key={cell.date}
                                        className={`min-h-[6.5rem] border-b border-r border-border-subtle p-1.5 ${
                                            cell.inMonth ? '' : 'bg-surface-hover/40'
                                        }`}
                                    >
                                        <p
                                            className={`text-[11px] mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full ${
                                                isToday
                                                    ? 'bg-accent text-white font-semibold'
                                                    : cell.inMonth
                                                      ? 'text-fg-secondary'
                                                      : 'text-fg-muted/50'
                                            }`}
                                        >
                                            {cell.day}
                                        </p>
                                        <div className="space-y-1">
                                            {dayEvents.slice(0, 3).map((event) => {
                                                const style = EVENT_STYLES[event.type]
                                                return (
                                                    <Link
                                                        key={event.id}
                                                        to={style.to}
                                                        title={`${event.title}${
                                                            event.amount !== undefined
                                                                ? ' · ' + formatCurrency(event.amount)
                                                                : ''
                                                        }`}
                                                        className={`block truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${style.className}`}
                                                    >
                                                        {event.title}
                                                    </Link>
                                                )
                                            })}
                                            {dayEvents.length > 3 && (
                                                <p className="text-[10px] text-fg-muted px-1">
                                                    +{dayEvents.length - 3} more
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </AsyncContent>

            <div className="flex flex-wrap gap-3 mt-4">
                {(Object.keys(EVENT_STYLES) as CalendarEventType[]).map((type) => (
                    <span
                        key={type}
                        className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${EVENT_STYLES[type].className}`}
                    >
                        {EVENT_STYLES[type].label}
                    </span>
                ))}
            </div>
        </div>
    )
}

export default CalendarPage
