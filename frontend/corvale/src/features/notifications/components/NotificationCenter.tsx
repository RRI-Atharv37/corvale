import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FiBell, FiCheck, FiX } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import type { ApiResponse } from '@lib/types/api'
import type { NotificationListPayload } from '@features/notifications/types'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { formatRelativeTime } from '@lib/format'

const notificationLink = (type: string, referenceId?: string): string | null => {
    if (!referenceId) return null
    switch (type) {
        case 'budget_over_limit':
            return '/budgets'
        case 'bill_due':
            return '/recurring'
        case 'savings_milestone':
            return '/savings-goals'
        case 'workspace_invite':
            return '/workspaces?tab=invitations'
        default:
            return null
    }
}

const NotificationCenter: React.FC = () => {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notifications, setNotifications] = useState<NotificationListPayload['notifications']>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const panelRef = useRef<HTMLDivElement>(null)

    const fetchNotifications = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const response = await axiosInstance.get<ApiResponse<NotificationListPayload>>(
                API_PATHS.NOTIFICATIONS.GET_ALL
            )
            const payload = unwrapApiData(response)
            setNotifications(payload.notifications)
            setUnreadCount(payload.unreadCount)
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to load notifications'))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void fetchNotifications()
    }, [fetchNotifications])

    useEffect(() => {
        if (!open) return

        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [open])

    const handleMarkRead = async (notificationId: string) => {
        try {
            await axiosInstance.patch(API_PATHS.NOTIFICATIONS.MARK_READ(notificationId))
            setNotifications((prev) =>
                prev.map((entry) =>
                    entry._id === notificationId
                        ? { ...entry, readAt: entry.readAt ?? new Date().toISOString() }
                        : entry
                )
            )
            setUnreadCount((prev) => Math.max(0, prev - 1))
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to mark notification as read'))
        }
    }

    const handleDismiss = async (notificationId: string) => {
        try {
            await axiosInstance.patch(API_PATHS.NOTIFICATIONS.DISMISS(notificationId))
            setNotifications((prev) => prev.filter((entry) => entry._id !== notificationId))
            setUnreadCount((prev) => {
                const dismissed = notifications.find((entry) => entry._id === notificationId)
                return dismissed && !dismissed.readAt ? Math.max(0, prev - 1) : prev
            })
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to dismiss notification'))
        }
    }

    const handleMarkAllRead = async () => {
        try {
            await axiosInstance.patch(API_PATHS.NOTIFICATIONS.MARK_ALL_READ)
            setNotifications((prev) =>
                prev.map((entry) => ({
                    ...entry,
                    readAt: entry.readAt ?? new Date().toISOString(),
                }))
            )
            setUnreadCount(0)
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to mark all as read'))
        }
    }

    const toggleOpen = () => {
        setOpen((prev) => !prev)
        if (!open) {
            void fetchNotifications()
        }
    }

    return (
        <div className="relative" ref={panelRef}>
            <button
                type="button"
                onClick={toggleOpen}
                className="relative flex items-center justify-center h-9 w-9 rounded-lg border border-border text-fg-muted hover:text-accent hover:border-accent/40 transition-colors"
                aria-label="Notifications"
                aria-expanded={open}
            >
                <FiBell size={16} />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-on-accent">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                        <p className="text-sm font-semibold text-fg">Notifications</p>
                        {unreadCount > 0 && (
                            <button
                                type="button"
                                onClick={() => void handleMarkAllRead()}
                                className="text-xs font-medium text-accent hover:text-accent"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                        {loading && notifications.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-fg-muted">
                                Loading notifications...
                            </p>
                        ) : error ? (
                            <p className="px-4 py-6 text-sm text-expense">{error}</p>
                        ) : notifications.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-fg-muted">
                                No notifications yet. Budget alerts, bill reminders, savings
                                milestones, and workspace invitations will show up here.
                            </p>
                        ) : (
                            <ul className="divide-y divide-slate-800">
                                {notifications.map((notification) => {
                                    const href = notificationLink(
                                        notification.type,
                                        notification.referenceId
                                    )
                                    const isUnread = !notification.readAt

                                    return (
                                        <li
                                            key={notification._id}
                                            className={[
                                                'px-4 py-3',
                                                isUnread ? 'bg-accent-subtle' : 'bg-transparent',
                                            ].join(' ')}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-medium text-fg">
                                                        {notification.title}
                                                    </p>
                                                    <p className="mt-1 text-xs text-fg-muted leading-relaxed">
                                                        {notification.message}
                                                    </p>
                                                    <p className="mt-2 text-[11px] text-fg-muted">
                                                        {formatRelativeTime(notification.createdAt)}
                                                    </p>
                                                    {href && (
                                                        <Link
                                                            to={href}
                                                            onClick={() => setOpen(false)}
                                                            className="mt-2 inline-block text-xs font-medium text-accent hover:text-accent"
                                                        >
                                                            View details
                                                        </Link>
                                                    )}
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    {isUnread && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                void handleMarkRead(notification._id)
                                                            }
                                                            className="rounded p-1 text-fg-muted hover:text-accent"
                                                            aria-label="Mark as read"
                                                            title="Mark as read"
                                                        >
                                                            <FiCheck size={14} />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void handleDismiss(notification._id)
                                                        }
                                                        className="rounded p-1 text-fg-muted hover:text-expense"
                                                        aria-label="Dismiss"
                                                        title="Dismiss"
                                                    >
                                                        <FiX size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default NotificationCenter
