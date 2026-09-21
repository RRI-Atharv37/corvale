import { useState } from 'react'

import { ActionDialog } from '../components/ActionDialog'
import { useStepUp } from '../components/StepUp'
import { Badge, Button, ErrorAlert, Field, Section, Spinner, inputClass } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatDateTime, humanize } from '../lib/format'
import type { AdminListItem, AdminRole, EnrolmentGrant } from '../lib/types'
import { useAsync } from '../lib/useAsync'

type Dialog = { kind: 'invite' } | { kind: 'reset' | 'disable' | 'enable'; admin: AdminListItem }

const ROLES: AdminRole[] = ['support', 'finance', 'owner']

const statusTone = (status: string) => (status === 'active' ? 'good' : status === 'disabled' ? 'bad' : 'warn')

const enrolLink = (grant: EnrolmentGrant): string => `${window.location.origin}/enrol#token=${grant.enrolmentToken}`

const AdminsPage = () => {
  const { admin: me } = useAuth()
  const { run } = useStepUp()
  const admins = useAsync(() => api.listAdmins(), [])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [role, setRole] = useState<AdminRole>('support')
  const [email, setEmail] = useState('')
  const [grant, setGrant] = useState<{ label: string; link: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const finish = () => {
    setDialog(null)
    admins.reload()
  }

  const copy = async () => {
    if (!grant) return
    await navigator.clipboard.writeText(grant.link)
    setCopied(true)
  }

  const submit = (reason: string): Promise<void> => {
    if (!dialog) return Promise.resolve()

    if (dialog.kind === 'invite') {
      return run(() => api.invite({ email: email.trim(), role, reason })).then((result) => {
        setGrant({ label: `Invitation for ${email.trim()}`, link: enrolLink(result), expiresAt: result.expiresAt })
        setEmail('')
        setCopied(false)
        finish()
      })
    }

    const target = dialog.admin
    if (dialog.kind === 'reset') {
      return run(() => api.resetTotp(target.id, { reason })).then((result) => {
        setGrant({ label: `New enrolment link for ${target.email}`, link: enrolLink(result), expiresAt: result.expiresAt })
        setCopied(false)
        finish()
      })
    }
    return run(() => api.setAdminStatus(target.id, { status: dialog.kind === 'enable' ? 'active' : 'disabled', reason })).then(finish)
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Admins</h1>
        <Button variant="primary" onClick={() => setDialog({ kind: 'invite' })}>
          Invite admin
        </Button>
      </div>

      {grant ? (
        <Section title="Enrolment link">
          <p className="text-sm">{grant.label}. It works once and expires {formatDateTime(grant.expiresAt)}. Send it over a private channel; it is not shown again.</p>
          <p className="mt-2 break-all rounded-md border border-border bg-page p-2 font-mono text-xs">{grant.link}</p>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</Button>
            <Button onClick={() => setGrant(null)}>Dismiss</Button>
          </div>
        </Section>
      ) : null}

      <Section title="Accounts">
        <ErrorAlert message={admins.error} />
        {admins.loading && !admins.data ? <Spinner /> : null}
        {admins.data ? (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="py-1 pr-4 font-medium">Admin</th>
                <th className="py-1 pr-4 font-medium">Role</th>
                <th className="py-1 pr-4 font-medium">Status</th>
                <th className="py-1 pr-4 font-medium">Last sign-in</th>
                <th className="py-1 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {admins.data.admins.map((item) => (
                <tr key={item.id}>
                  <td className="py-2 pr-4">{item.email}</td>
                  <td className="py-2 pr-4">{item.role}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={statusTone(item.status)}>{humanize(item.status)}</Badge>
                    {item.moneyBlockedUntil ? <span className="ml-2 text-xs text-warn">sensitive actions blocked until {formatDateTime(item.moneyBlockedUntil)}</span> : null}
                  </td>
                  <td className="py-2 pr-4">{formatDateTime(item.lastLoginAt)}</td>
                  <td className="py-2">
                    {item.id === me?.id ? (
                      <span className="text-xs text-text-muted">you</span>
                    ) : (
                      <span className="flex flex-wrap gap-2">
                        {item.status === 'active' || item.status === 'reenrol' ? <Button onClick={() => setDialog({ kind: 'reset', admin: item })}>Reset authenticator</Button> : null}
                        {item.status === 'disabled' ? (
                          <Button onClick={() => setDialog({ kind: 'enable', admin: item })}>Enable</Button>
                        ) : (
                          <Button onClick={() => setDialog({ kind: 'disable', admin: item })}>Disable</Button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      {dialog?.kind === 'invite' ? (
        <ActionDialog
          title="Invite an admin"
          submitLabel="Create invitation"
          description="Creates a pending account and a single-use link, valid for 24 hours. They choose their password and set up an authenticator."
          canSubmit={email.trim().length > 3}
          onCancel={() => setDialog(null)}
          onSubmit={submit}
        >
          <Field label="Email" htmlFor="invite-email">
            <input id="invite-email" className={inputClass} type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint="Support: look up and grant. Finance: money and metrics. Owner: everything, including admins.">
            <select id="invite-role" className={inputClass} value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </ActionDialog>
      ) : null}

      {dialog && dialog.kind !== 'invite' ? (
        <ActionDialog
          title={dialog.kind === 'reset' ? `Reset authenticator for ${dialog.admin.email}` : dialog.kind === 'disable' ? `Disable ${dialog.admin.email}` : `Enable ${dialog.admin.email}`}
          submitLabel={dialog.kind === 'reset' ? 'Reset authenticator' : dialog.kind === 'disable' ? 'Disable' : 'Enable'}
          variant={dialog.kind === 'enable' ? 'primary' : 'danger'}
          description={
            dialog.kind === 'reset'
              ? 'Ends their sessions and clears their authenticator and recovery codes. They must enrol again with a new link and confirm their existing password. Sensitive actions stay blocked for them for 24 hours.'
              : dialog.kind === 'disable'
                ? 'Ends their sessions and blocks sign-in until they are enabled again.'
                : 'Lets them sign in again.'
          }
          onCancel={() => setDialog(null)}
          onSubmit={submit}
        />
      ) : null}
    </>
  )
}

export default AdminsPage
