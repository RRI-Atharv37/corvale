import React, { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
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
    FiPieChart,
    FiFlag,
    FiCalendar,
    FiBarChart2,
    FiSettings,
} from 'react-icons/fi'
import { useUser } from '../../hooks/useUser'
import toast from 'react-hot-toast'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import CurrencySelect from '../inputs/CurrencySelect'
import Modal from '../ui/Modal'
import { DEFAULT_CURRENCY } from '../../utils/currencies'
import type { ApiResponse, User } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'

const DOCS_URL = 'http://localhost:5174'

interface NavItem {
    to: string
    label: string
    icon: React.ReactNode
}

const navItems: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: <FiHome size={18} /> },
    { to: '/transactions', label: 'Transactions', icon: <FiList size={18} /> },
    { to: '/accounts', label: 'Accounts', icon: <FiCreditCard size={18} /> },
    { to: '/categories', label: 'Categories', icon: <FiGrid size={18} /> },
    { to: '/budgets', label: 'Budgets', icon: <FiPieChart size={18} /> },
    { to: '/savings-goals', label: 'Savings Goals', icon: <FiFlag size={18} /> },
    { to: '/recurring', label: 'Recurring', icon: <FiCalendar size={18} /> },
    { to: '/reports', label: 'Reports', icon: <FiBarChart2 size={18} /> },
    { to: '/saver', label: 'Saver', icon: <FiDollarSign size={18} /> },
    { to: '/pushover', label: 'Pushover', icon: <FiRepeat size={18} /> },
]

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
    [
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        isActive
            ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60',
    ].join(' ')

const DashboardLayout: React.FC = () => {
    const { user, updateUser, logout, logoutAllSessions } = useUser()
    const navigate = useNavigate()
    const [mobileOpen, setMobileOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [savingCurrency, setSavingCurrency] = useState(false)

    const handlePreferredCurrencyChange = async (value: string) => {
        if (!user) return

        setSavingCurrency(true)
        try {
            const response = await axiosInstance.patch<ApiResponse<User>>(API_PATHS.AUTH.UPDATE_USER, {
                preferredCurrency: value,
            })
            updateUser(unwrapApiData(response))
            toast.success('Default currency updated')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to update currency'))
        } finally {
            setSavingCurrency(false)
        }
    }

    const handleLogout = async () => {
        setSettingsOpen(false)
        closeMobile()
        await logout()
        toast.success('Logged out successfully')
        navigate('/login', { replace: true })
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
        navigate('/login', { replace: true })
    }

    const closeMobile = () => setMobileOpen(false)

    const openSettings = () => {
        setSettingsOpen(true)
        closeMobile()
    }

    const sidebarContent = (
        <>
            <div className="shrink-0 px-4 py-6 border-b border-slate-800">
                <p className="text-lg font-semibold tracking-tight">
                    <span className="text-cyan-400">spndr</span>
                </p>
                <p className="text-xs text-slate-500 mt-1">Personal finance</p>
            </div>

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
                <div className="shrink-0 border-t border-slate-800 px-3 py-3">
                    <div className="flex items-center gap-2 rounded-lg px-2 py-2">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-200 truncate">{user.fullName}</p>
                            <p className="text-xs text-slate-500 truncate">{user.email}</p>
                        </div>
                        <button
                            type="button"
                            onClick={openSettings}
                            className="flex shrink-0 items-center justify-center h-8 w-8 rounded-lg border border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-colors"
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
        <div className="min-h-screen bg-slate-950 text-slate-100 flex">
            {/* Desktop sidebar */}
            <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:h-screen border-r border-slate-800 bg-slate-900/50 backdrop-blur-sm">
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
                    <aside className="relative z-50 flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900">
                        {sidebarContent}
                    </aside>
                </div>
            )}

            {/* Main content */}
            <div className="flex-1 lg:pl-64 min-w-0">
                <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 py-3 lg:px-8">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            type="button"
                            className="lg:hidden flex shrink-0 items-center justify-center h-9 w-9 rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40"
                            aria-label="Open navigation"
                            onClick={() => setMobileOpen(true)}
                        >
                            <FiMenu size={18} />
                        </button>

                        <p className="text-sm text-slate-400 truncate">
                            Welcome{user ? `, ${user.fullName.split(' ')[0]}` : ''}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <a
                            href={DOCS_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors"
                        >
                            <FiBookOpen size={16} />
                            <span className="hidden sm:inline">Docs</span>
                        </a>
                    </div>
                </header>

                <main className="px-4 py-6 lg:px-8 lg:py-8 max-w-6xl">
                    <Outlet />
                </main>
            </div>

            <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" size="sm">
                <div className="space-y-6">
                    <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Preferences</p>
                        <CurrencySelect
                            label="Default currency"
                            value={user?.preferredCurrency ?? DEFAULT_CURRENCY}
                            onChange={(value) => void handlePreferredCurrencyChange(value)}
                            disabled={savingCurrency}
                        />
                    </div>

                    <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Account</p>
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() => void handleLogoutAll()}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                            >
                                <FiLogOut size={18} />
                                Logout all devices
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleLogout()}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                            >
                                <FiLogOut size={18} />
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

export default DashboardLayout
