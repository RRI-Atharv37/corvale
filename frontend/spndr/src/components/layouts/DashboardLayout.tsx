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
} from 'react-icons/fi'
import { useUser } from '../../hooks/useUser'
import toast from 'react-hot-toast'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import CurrencySelect from '../inputs/CurrencySelect'
import { DEFAULT_CURRENCY } from '../../utils/currencies'
import type { ApiResponse, User } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'

interface NavItem {
    to: string
    label: string
    icon: React.ReactNode
    external?: boolean
}

const navItems: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: <FiHome size={18} /> },
    { to: '/transactions', label: 'Transactions', icon: <FiList size={18} /> },
    { to: '/accounts', label: 'Accounts', icon: <FiCreditCard size={18} /> },
    { to: '/categories', label: 'Categories', icon: <FiGrid size={18} /> },
    { to: '/budgets', label: 'Budgets', icon: <FiPieChart size={18} /> },
    { to: '/saver', label: 'Saver', icon: <FiDollarSign size={18} /> },
    { to: '/pushover', label: 'Pushover', icon: <FiRepeat size={18} /> },
    { to: 'http://localhost:5174', label: 'Docs', icon: <FiBookOpen size={18} />, external: true },
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
        await logout()
        toast.success('Logged out successfully')
        navigate('/login', { replace: true })
    }

    const handleLogoutAll = async () => {
        const confirmed = window.confirm(
            'Sign out of all devices? You will need to sign in again everywhere.'
        )
        if (!confirmed) return

        await logoutAllSessions()
        toast.success('All sessions revoked')
        navigate('/login', { replace: true })
    }

    const closeMobile = () => setMobileOpen(false)

    const sidebarContent = (
        <>
            <div className="px-4 py-6 border-b border-slate-800">
                <p className="text-lg font-semibold tracking-tight">
                    <span className="text-cyan-400">spndr</span>
                </p>
                <p className="text-xs text-slate-500 mt-1">Personal finance</p>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1">
                {navItems.map((item) => (
                    item.external ? (
                        <a
                            key={item.to}
                            href={item.to}
                            className={navLinkClass({ isActive: false })}
                            onClick={closeMobile}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {item.icon}
                            {item.label}
                        </a>
                    ) : (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={navLinkClass}
                            onClick={closeMobile}
                        >
                            {item.icon}
                            {item.label}
                        </NavLink>
                    )
                ))}
            </nav>

            <div className="px-3 py-4 border-t border-slate-800">
                {user && (
                    <div className="px-3 py-2 mb-2 space-y-3">
                        <div>
                            <p className="text-sm font-medium text-slate-200 truncate">{user.fullName}</p>
                            <p className="text-xs text-slate-500 truncate">{user.email}</p>
                        </div>
                        <CurrencySelect
                            label="Default currency"
                            value={user.preferredCurrency ?? DEFAULT_CURRENCY}
                            onChange={(value) => void handlePreferredCurrencyChange(value)}
                            disabled={savingCurrency}
                        />
                    </div>
                )}
                <button
                    type="button"
                    onClick={() => void handleLogoutAll()}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors mb-1"
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
        </>
    )

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex">
            {/* Desktop sidebar */}
            <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-800 bg-slate-900/50 backdrop-blur-sm">
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
            <div className="flex-1 lg:pl-64">
                <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 py-3 lg:px-8">
                    <button
                        type="button"
                        className="lg:hidden flex items-center justify-center h-9 w-9 rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40"
                        aria-label="Open navigation"
                        onClick={() => setMobileOpen(true)}
                    >
                        <FiMenu size={18} />
                    </button>

                    <div className="flex-1 lg:flex-none">
                        <p className="text-sm text-slate-400 hidden sm:block">
                            Welcome{user ? `, ${user.fullName.split(' ')[0]}` : ''}
                        </p>
                    </div>

                    {mobileOpen && (
                        <button
                            type="button"
                            className="lg:hidden flex items-center justify-center h-9 w-9 rounded-lg border border-slate-700 text-slate-300"
                            aria-label="Close navigation"
                            onClick={closeMobile}
                        >
                            <FiX size={18} />
                        </button>
                    )}
                </header>

                <main className="px-4 py-6 lg:px-8 lg:py-8 max-w-6xl">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}

export default DashboardLayout
