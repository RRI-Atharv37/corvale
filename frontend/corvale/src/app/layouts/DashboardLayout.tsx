import React, { Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
    FiHome,
    FiList,
    FiDollarSign,
    FiBookOpen,
    FiRepeat,
    FiLogOut,
    FiMenu,
    FiX,
    FiCreditCard,
    FiGrid,
    FiTag,
    FiPieChart,
    FiFlag,
    FiCalendar,
    FiBarChart2,
    FiSettings,
    FiUsers,
    FiTrendingUp,
    FiClock,
    FiLayers,
    FiTrendingDown,
    FiCompass,
    FiDownload,
} from 'react-icons/fi'
import { BRAND } from '@lib/brand'
import OnboardingWizard, { OnboardingWizardHandle } from '@features/onboarding/components/OnboardingWizard'
import PinSetupPrompt from '@features/onboarding/components/PinSetupPrompt'
import PinSettings from '@features/settings/components/PinSettings'
import WorkspaceSwitcher from '@features/workspaces/components/WorkspaceSwitcher'
import { useUser } from '../providers/useUser'
import toast from 'react-hot-toast'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import CurrencySelect from '@ui/inputs/CurrencySelect'
import Modal from '@ui/Modal'
import ExternalLink from '@ui/ExternalLink'
import { DEFAULT_CURRENCY } from '@lib/currencies'
import {
    DATE_FORMAT_OPTIONS,
    DEFAULT_DATE_FORMAT,
    DEFAULT_PAGE_SIZE,
    PAGE_SIZE_OPTIONS,
    type DateFormat,
} from '@lib/userPreferences'
import type { ApiResponse, User } from '@lib/types/api'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import NotificationCenter from '@features/notifications/components/NotificationCenter'
import LoadingState from '@ui/LoadingState'
import ProfileSettings from '@features/settings/components/ProfileSettings'
import TransactionTemplatesSettings from '@features/settings/components/TransactionTemplatesSettings'
import BackupRestoreSettings from '@features/settings/components/BackupRestoreSettings'
import DeleteAccountSettings from '@features/settings/components/DeleteAccountSettings'
import PrivacyDataSettings from '@features/settings/components/PrivacyDataSettings'
import ExchangeRatesSettings from '@features/settings/components/ExchangeRatesSettings'
import SyncSettings from '@features/settings/components/SyncSettings'
import DesktopUpdateSettings from '@features/settings/components/DesktopUpdateSettings'
import SyncStatusBadge from '@features/settings/components/SyncStatusBadge'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { isLocalPinEnabled } from '@lib/localPinFlag'
import { startSyncEngine, syncNow } from '@platform/sync/syncEngine'
import { countUnsyncedChanges, syncBeforeSignOut } from '@platform/offline/signOutFlow'
import SignOutDialog from '@features/settings/components/SignOutDialog'
import { syncTimezoneOncePerSession } from '@platform/timezoneSync'

const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? 'http://localhost:5174'

interface NavItem {
    to: string
    label: string
    icon: React.ReactNode
}

const navItems: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: <FiHome size={18} /> },
    { to: '/transactions', label: 'Transactions', icon: <FiList size={18} /> },
    { to: '/accounts', label: 'Accounts', icon: <FiCreditCard size={18} /> },
    { to: '/budgets', label: 'Budgets', icon: <FiPieChart size={18} /> },
    { to: '/categories', label: 'Categories', icon: <FiGrid size={18} /> },
    { to: '/reports', label: 'Reports & Analytics', icon: <FiBarChart2 size={18} /> },
    { to: '/calendar', label: 'Calendar', icon: <FiClock size={18} /> },
    { to: '/tags', label: 'Tags', icon: <FiTag size={18} /> },
    { to: '/recurring', label: 'Recurring', icon: <FiCalendar size={18} /> },
    { to: '/subscriptions', label: 'Subscriptions', icon: <FiLayers size={18} /> },
    { to: '/debts', label: 'Debt Payoff', icon: <FiTrendingDown size={18} /> },
    { to: '/savings-goals', label: 'Savings Goals', icon: <FiFlag size={18} /> },
    { to: '/forecast', label: 'Forecast', icon: <FiTrendingUp size={18} /> },
    { to: '/workspaces', label: 'Workspaces', icon: <FiUsers size={18} /> },
    { to: '/saver', label: 'Saver', icon: <FiDollarSign size={18} /> },
    { to: '/pushover', label: 'Pushover', icon: <FiRepeat size={18} /> },
]

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
    [
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        isActive
            ? 'nav-active'
            : 'text-text-muted hover:text-text-primary hover:bg-elevated-hover',
    ].join(' ')

const DashboardLayout: React.FC = () => {
    const { user, updateUser, logout, logoutAllSessions } = useUser()
    const navigate = useNavigate()
    const [mobileOpen, setMobileOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [savingCurrency, setSavingCurrency] = useState(false)
    const [savingNotifications, setSavingNotifications] = useState(false)
    const [savingDisplay, setSavingDisplay] = useState(false)
    const onboardingRef = useRef<OnboardingWizardHandle>(null)
    // SEC-46: sign-out wipes the local store, so warn before dropping unsynced local changes.
    const [signOutDialogOpen, setSignOutDialogOpen] = useState(false)
    const [signOutUnsyncedCount, setSignOutUnsyncedCount] = useState(0)
    const [signOutSyncing, setSignOutSyncing] = useState(false)

    useEffect(() => {
        if (!isLocalFirstEnabled()) return
        const stop = startSyncEngine()
        void syncNow()
        return stop
    }, [])

    // V5: keep the stored timezone in step with the device, once per session. Self-guarded and
    // silent - see `utils/timezoneSync.ts`.
    useEffect(() => {
        void syncTimezoneOncePerSession(user, updateUser)
    }, [user, updateUser])

    const handleReplayOnboarding = () => {
        setSettingsOpen(false)
        closeMobile()
        onboardingRef.current?.replay()
    }

    const handlePreferredCurrencyChange = async (value: string) => {
        if (!user) return

        setSavingCurrency(true)
        try {
            const response = await axiosInstance.patch<ApiResponse<User>>(API_PATHS.AUTH.UPDATE_USER, {
                preferredCurrency: value,
            })
            updateUser(unwrapApiData(response))
            toast.success('Default currency updated across all records')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to update currency'))
        } finally {
            setSavingCurrency(false)
        }
    }

    const handleBillRemindersToggle = async (enabled: boolean) => {
        if (!user) return

        setSavingNotifications(true)
        try {
            const response = await axiosInstance.patch<ApiResponse<User>>(API_PATHS.AUTH.UPDATE_USER, {
                notificationPreferences: {
                    billRemindersEnabled: enabled,
                    billReminderDaysBefore: user.notificationPreferences?.billReminderDaysBefore ?? 3,
                },
            })
            updateUser(unwrapApiData(response))
            toast.success(enabled ? 'Bill reminders enabled' : 'Bill reminders disabled')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to update notification preferences'))
        } finally {
            setSavingNotifications(false)
        }
    }

    const handleBillReminderDaysChange = async (days: number) => {
        if (!user) return

        setSavingNotifications(true)
        try {
            const response = await axiosInstance.patch<ApiResponse<User>>(API_PATHS.AUTH.UPDATE_USER, {
                notificationPreferences: {
                    billRemindersEnabled: user.notificationPreferences?.billRemindersEnabled ?? true,
                    billReminderDaysBefore: days,
                },
            })
            updateUser(unwrapApiData(response))
            toast.success('Bill reminder timing updated')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to update notification preferences'))
        } finally {
            setSavingNotifications(false)
        }
    }

    const handleDateFormatChange = async (value: DateFormat) => {
        if (!user) return

        setSavingDisplay(true)
        try {
            const response = await axiosInstance.patch<ApiResponse<User>>(API_PATHS.AUTH.UPDATE_USER, {
                dateFormat: value,
            })
            updateUser(unwrapApiData(response))
            toast.success('Date format updated')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to update date format'))
        } finally {
            setSavingDisplay(false)
        }
    }

    const handlePageSizeChange = async (value: number) => {
        if (!user) return

        setSavingDisplay(true)
        try {
            const response = await axiosInstance.patch<ApiResponse<User>>(API_PATHS.AUTH.UPDATE_USER, {
                pageSize: value,
            })
            updateUser(unwrapApiData(response))
            toast.success('Cards per page updated')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to update cards per page'))
        } finally {
            setSavingDisplay(false)
        }
    }

    const doSignOut = async () => {
        setSignOutDialogOpen(false)
        setSettingsOpen(false)
        closeMobile()
        await logout()
        toast.success('Logged out successfully')
        navigate('/', { replace: true })
    }

    const handleLogout = async () => {
        const unsynced = await countUnsyncedChanges()
        if (unsynced > 0) {
            setSignOutUnsyncedCount(unsynced)
            setSignOutDialogOpen(true)
            return
        }
        await doSignOut()
    }

    const handleSyncAndSignOut = async () => {
        setSignOutSyncing(true)
        try {
            const remaining = await syncBeforeSignOut()
            if (remaining > 0) {
                setSignOutUnsyncedCount(remaining)
                toast.error(
                    `${remaining} ${remaining === 1 ? 'change' : 'changes'} still could not sync. Discard them or cancel and try again later.`
                )
                return
            }
            await doSignOut()
        } finally {
            setSignOutSyncing(false)
        }
    }

    const handleLogoutAll = async () => {
        const confirmed = window.confirm(
            'Sign out of all devices? You will need to sign in again everywhere.'
        )
        if (!confirmed) return

        setSettingsOpen(false)
        closeMobile()
        await logoutAllSessions()
        toast.success('All sessions revoked')
        navigate('/', { replace: true })
    }

    const closeMobile = () => setMobileOpen(false)

    const openSettings = () => {
        setSettingsOpen(true)
        closeMobile()
    }

    const sidebarContent = (
        <>
            <div className="shrink-0 px-4 py-6 border-b border-border-subtle">
                <p className="font-display text-lg font-bold tracking-tight">
                    <span className="text-gradient-accent">{BRAND.name}</span>
                </p>
                <p className="text-xs text-text-quiet mt-1">Stop guessing. Start knowing.</p>
            </div>

            <WorkspaceSwitcher />

            <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1">
                {navItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={navLinkClass}
                        onClick={closeMobile}
                    >
                        {item.icon}
                        {item.label}
                    </NavLink>
                ))}
            </nav>

            {user && (
                <div className="shrink-0 border-t border-border-subtle px-3 py-3">
                    <div className="flex items-center gap-2 rounded-lg px-2 py-2">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-text-primary truncate">{user.fullName}</p>
                            <p className="text-xs text-text-quiet truncate">{user.email}</p>
                        </div>
                        <button
                            type="button"
                            onClick={openSettings}
                            className="flex shrink-0 items-center justify-center h-8 w-8 rounded-lg border border-border-subtle text-text-muted hover:text-accent hover:border-accent/40 hover:bg-accent-subtle transition-colors"
                            aria-label="Open settings"
                            title="Settings"
                        >
                            <FiSettings size={16} />
                        </button>
                    </div>
                </div>
            )}
        </>
    )

    return (
        <div className="min-h-screen bg-page text-text-primary flex">
            {/* Desktop sidebar */}
            <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:h-screen border-r border-border-subtle bg-elevated bg-gradient-to-b from-elevated to-bg-secondary">
                {sidebarContent}
            </aside>

            {/* Mobile sidebar overlay */}
            {mobileOpen && (
                <div className="fixed inset-0 z-40 lg:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/60"
                        aria-label="Close navigation"
                        onClick={closeMobile}
                    />
                    <aside className="relative z-50 flex h-full w-64 flex-col border-r border-border-subtle bg-elevated bg-gradient-to-b from-elevated to-bg-secondary">
                        {sidebarContent}
                    </aside>
                </div>
            )}

            {/* Main content */}
            <div className="flex-1 lg:pl-64 min-w-0">
                <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border-subtle glass px-4 py-3 lg:px-8">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            type="button"
                            className="lg:hidden flex shrink-0 items-center justify-center h-9 w-9 rounded-lg border border-border-subtle text-text-secondary hover:border-accent/40"
                            aria-label="Open navigation"
                            onClick={() => setMobileOpen(true)}
                        >
                            <FiMenu size={18} />
                        </button>

                        <p className="text-sm text-text-muted truncate">
                            Welcome{user ? `, ${user.fullName.split(' ')[0]}` : ''}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {isLocalFirstEnabled() && <SyncStatusBadge />}
                        <NotificationCenter />
                        <ExternalLink
                            href={DOCS_URL}
                            className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
                        >
                            <FiBookOpen size={16} />
                            <span className="hidden sm:inline">Docs</span>
                        </ExternalLink>
                    </div>
                </header>

                <main className="px-4 py-6 lg:px-8 lg:py-8 max-w-6xl">
                    <Suspense fallback={<LoadingState message="Loading page..." />}>
                        <Outlet />
                    </Suspense>
                </main>
            </div>

            <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" size="md">
                <div className="space-y-6">
                    <ProfileSettings />

                    <div>
                        <p className="section-label mb-3">Preferences</p>
                        <CurrencySelect
                            label="Default currency"
                            value={user?.preferredCurrency ?? DEFAULT_CURRENCY}
                            onChange={(value) => void handlePreferredCurrencyChange(value)}
                            disabled={savingCurrency}
                        />
                        <label className="block text-sm text-text-secondary mt-4">
                            Date format
                            <select
                                value={user?.dateFormat ?? DEFAULT_DATE_FORMAT}
                                onChange={(event) =>
                                    void handleDateFormatChange(event.target.value as DateFormat)
                                }
                                disabled={savingDisplay}
                                className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                            >
                                {DATE_FORMAT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block text-sm text-text-secondary mt-4">
                            Cards per page
                            <select
                                value={user?.pageSize ?? DEFAULT_PAGE_SIZE}
                                onChange={(event) =>
                                    void handlePageSizeChange(Number(event.target.value))
                                }
                                disabled={savingDisplay}
                                className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                            >
                                {PAGE_SIZE_OPTIONS.map((option) => (
                                    <option key={option} value={option}>
                                        {option} cards
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="mt-4 space-y-3">
                            <label className="flex items-center justify-between gap-3 text-sm text-text-secondary">
                                <span>Bill due reminders</span>
                                <input
                                    type="checkbox"
                                    checked={user?.notificationPreferences?.billRemindersEnabled ?? true}
                                    onChange={(event) =>
                                        void handleBillRemindersToggle(event.target.checked)
                                    }
                                    disabled={savingNotifications}
                                    className="h-4 w-4 rounded border-border bg-elevated text-accent focus:ring-accent/40"
                                />
                            </label>
                            <label className="block text-sm text-text-secondary">
                                Remind me before bills are due
                                <select
                                    value={user?.notificationPreferences?.billReminderDaysBefore ?? 3}
                                    onChange={(event) =>
                                        void handleBillReminderDaysChange(Number(event.target.value))
                                    }
                                    disabled={
                                        savingNotifications ||
                                        !(user?.notificationPreferences?.billRemindersEnabled ?? true)
                                    }
                                    className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                                >
                                    <option value={0}>Same day</option>
                                    <option value={1}>1 day</option>
                                    <option value={3}>3 days</option>
                                    <option value={7}>7 days</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <TransactionTemplatesSettings />
                    <ExchangeRatesSettings />
                    <BackupRestoreSettings />
                    <DesktopUpdateSettings />
                    {isLocalFirstEnabled() && <SyncSettings />}
                    {isLocalPinEnabled() && <PinSettings />}

                    <div>
                        <p className="section-label mb-3">Account</p>
                        <div className="space-y-2">
                            <Link
                                to="/download"
                                onClick={() => setSettingsOpen(false)}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-muted hover:text-accent hover:bg-accent-subtle transition-colors"
                            >
                                <FiDownload size={18} />
                                Get the desktop app
                            </Link>
                            <button
                                type="button"
                                onClick={handleReplayOnboarding}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-muted hover:text-accent hover:bg-accent-subtle transition-colors"
                            >
                                <FiCompass size={18} />
                                Replay onboarding tour
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleLogoutAll()}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-muted hover:text-warning hover:bg-warning/10 transition-colors"
                            >
                                <FiLogOut size={18} />
                                Logout all devices
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleLogout()}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-muted hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                                <FiLogOut size={18} />
                                Logout
                            </button>
                        </div>
                    </div>

                    <PrivacyDataSettings />

                    <DeleteAccountSettings />
                </div>
            </Modal>

            <SignOutDialog
                open={signOutDialogOpen}
                unsyncedCount={signOutUnsyncedCount}
                syncing={signOutSyncing}
                onSyncAndSignOut={() => void handleSyncAndSignOut()}
                onDiscardAndSignOut={() => void doSignOut()}
                onCancel={() => setSignOutDialogOpen(false)}
            />

            <OnboardingWizard ref={onboardingRef} />
            <PinSetupPrompt />
        </div>
    )
}

export default DashboardLayout
