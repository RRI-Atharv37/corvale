import { NavLink, Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '../lib/auth'
import { Button, Spinner } from './ui'

const NAV: { to: string; label: string; capability?: string; end?: boolean }[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/subscribers', label: 'Subscribers', capability: 'subscribers.read' },
  { to: '/grandfather', label: 'Grandfather', capability: 'grandfather.write' },
  { to: '/metrics', label: 'Metrics', capability: 'metrics.read' },
  { to: '/audit', label: 'Audit log', capability: 'audit.read' },
  { to: '/admins', label: 'Admins', capability: 'admins.manage' },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-surface-2 text-text' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`

/** Everything behind sign-in. An anonymous visitor is sent to the login page and nothing else renders. */
export const RequireAuth = () => {
  const { status, admin, hasCapability, logout } = useAuth()

  if (status === 'loading') {
    return (
      <main className="mx-auto max-w-md p-8">
        <Spinner label="Checking session" />
      </main>
    )
  }
  if (status === 'anonymous') return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
          <span className="text-sm font-semibold">Corvale Admin</span>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            {NAV.filter((item) => !item.capability || hasCapability(item.capability)).map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-text-muted">
            <span>
              {admin?.email} <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{admin?.role}</span>
            </span>
            <Button onClick={() => void logout()}>Sign out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
