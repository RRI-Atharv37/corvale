import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ActionDialog } from '../components/ActionDialog'
import { Badge, Button, ErrorAlert, Facts, Field, Section, Spinner, inputClass } from '../components/ui'
import { api } from '../lib/api'
import { statusTone } from '../lib/tone'
import { useAuth } from '../lib/auth'
import { formatBytes, formatDate, formatDateTime, formatLimit, humanize, relativeDays } from '../lib/format'
import type { Meta, SubscriberDetail } from '../lib/types'
import { useAsync } from '../lib/useAsync'

type DialogKind = 'comp' | 'override' | 'trial' | 'hold' | 'revoke' | 'clearHold' | 'grandfather' | 'revokeGrandfather'

const bool = (value: boolean): string => (value ? 'yes' : 'no')
const yesNo = (value: boolean | null): string => (value === null ? '-' : bool(value))

const WriteBanner = ({ readOnly }: { readOnly: SubscriberDetail['readOnly'] }) => (
  <p
    role="status"
    aria-label="Write access"
    className={`rounded-md border px-3 py-2 text-sm ${readOnly.canWrite ? 'border-good/40 bg-good/10' : 'border-warn/40 bg-warn/10'}`}
  >
    <strong>{readOnly.canWrite ? 'Can write.' : 'Read-only.'}</strong> {readOnly.message}
  </p>
)

const payloadSummary = (payload: Record<string, unknown>): string =>
  Object.entries(payload)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ') || '-'

interface FieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  hint?: ReactNode
}

const NumberField = ({ id, label, value, onChange, min = 1, max, hint }: FieldProps) => (
  <Field label={label} htmlFor={id} hint={hint}>
    <input id={id} className={inputClass} type="number" inputMode="numeric" min={min} max={max} step={1} value={value} onChange={(event) => onChange(event.target.value)} />
  </Field>
)

const LimitField = ({ id, label, value, unlimited, onValue, onUnlimited }: { id: string; label: string; value: string; unlimited: boolean; onValue: (value: string) => void; onUnlimited: (value: boolean) => void }) => (
  <div className="space-y-1">
    <label htmlFor={id} className="block text-sm font-medium">
      {label}
    </label>
    <div className="flex items-center gap-3">
      <input id={id} className={inputClass} type="number" min={0} step={1} disabled={unlimited} placeholder="No change" value={value} onChange={(event) => onValue(event.target.value)} />
      <label className="flex items-center gap-1 whitespace-nowrap text-sm">
        <input type="checkbox" checked={unlimited} onChange={(event) => onUnlimited(event.target.checked)} />
        Unlimited
      </label>
    </div>
  </div>
)

interface DialogsProps {
  kind: DialogKind
  userId: string
  detail: SubscriberDetail
  meta: Meta | null
  done: () => void
  cancel: () => void
}

const MB = 1024 * 1024

const Dialogs = ({ kind, userId, detail, meta, done, cancel }: DialogsProps) => {
  const plans = meta?.plans ?? ['plus', 'pro']
  const grantCap = meta?.caps.grantDays
  const holdCap = meta?.caps.erasureHoldDays

  const grandfatherKinds = meta?.grandfatherKinds ?? ['free_forever', 'locked_rate', 'extended_trial']
  const [plan, setPlan] = useState(detail.subscription?.planCode ?? plans[plans.length - 1])
  const [days, setDays] = useState(kind === 'comp' || kind === 'override' ? '30' : kind === 'trial' ? '7' : '14')
  const [grandfatherKind, setGrandfatherKind] = useState(detail.subscription?.grandfatherKind ?? grandfatherKinds[0])
  const [overridePlan, setOverridePlan] = useState('')
  const [receiptMb, setReceiptMb] = useState('')
  const [devices, setDevices] = useState('')
  const [seats, setSeats] = useState('')
  const [unlimited, setUnlimited] = useState({ receipt: false, devices: false, seats: false })

  const wholeDays = Number(days)
  const daysValid = Number.isInteger(wholeDays) && wholeDays >= 1

  const run = async (action: () => Promise<unknown>) => {
    await action()
    done()
  }

  if (kind === 'comp') {
    return (
      <ActionDialog
        title="Comp this subscriber"
        submitLabel="Grant comp"
        description="Gives write access on a plan for a number of days without touching what the payment provider says. It ends by itself."
        canSubmit={daysValid}
        onCancel={cancel}
        onSubmit={(reason) => run(() => api.grant(userId, { kind: 'comp', planCode: plan, days: wholeDays, reason }))}
      >
        <Field label="Plan" htmlFor="grant-plan">
          <select id="grant-plan" className={inputClass} value={plan} onChange={(event) => setPlan(event.target.value)}>
            {plans.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <NumberField id="grant-days" label="Days" value={days} onChange={setDays} max={grantCap} hint={grantCap ? `Up to ${grantCap} days for your role.` : undefined} />
      </ActionDialog>
    )
  }

  if (kind === 'override') {
    const limits: Record<string, number | null> = {}
    const put = (key: string, raw: string, isUnlimited: boolean) => {
      if (isUnlimited) limits[key] = null
      else if (raw.trim() !== '') limits[key] = key === 'receiptStorageBytes' ? Math.round(Number(raw) * MB) : Number(raw)
    }
    put('receiptStorageBytes', receiptMb, unlimited.receipt)
    put('syncDevices', devices, unlimited.devices)
    put('workspaceMembers', seats, unlimited.seats)
    const hasChange = Boolean(overridePlan) || Object.keys(limits).length > 0

    return (
      <ActionDialog
        title="Plan override"
        submitLabel="Apply override"
        description="Raises what this customer's own plan gives. It can only add: it never lowers a limit, and it does not lift read-only (use a comp for that)."
        canSubmit={daysValid && hasChange}
        onCancel={cancel}
        onSubmit={(reason) =>
          run(() =>
            api.grant(userId, {
              kind: 'plan_override',
              days: wholeDays,
              reason,
              ...(overridePlan ? { planCode: overridePlan } : {}),
              ...(Object.keys(limits).length > 0 ? { limits } : {}),
            })
          )
        }
      >
        <Field label="Plan" htmlFor="override-plan">
          <select id="override-plan" className={inputClass} value={overridePlan} onChange={(event) => setOverridePlan(event.target.value)}>
            <option value="">No plan change</option>
            {plans.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <LimitField id="override-receipt" label="Receipt storage (MB)" value={receiptMb} unlimited={unlimited.receipt} onValue={setReceiptMb} onUnlimited={(value) => setUnlimited((state) => ({ ...state, receipt: value }))} />
        <LimitField id="override-devices" label="Sync devices" value={devices} unlimited={unlimited.devices} onValue={setDevices} onUnlimited={(value) => setUnlimited((state) => ({ ...state, devices: value }))} />
        <LimitField id="override-seats" label="Workspace members" value={seats} unlimited={unlimited.seats} onValue={setSeats} onUnlimited={(value) => setUnlimited((state) => ({ ...state, seats: value }))} />
        <NumberField id="override-days" label="Days" value={days} onChange={setDays} max={grantCap} hint={grantCap ? `Up to ${grantCap} days for your role.` : undefined} />
      </ActionDialog>
    )
  }

  if (kind === 'trial') {
    return (
      <ActionDialog
        title="Extend trial"
        submitLabel="Extend trial"
        description="Only a trial Corvale runs (no payment provider link). An expired trial reopens for the number of days from today."
        canSubmit={daysValid}
        onCancel={cancel}
        onSubmit={(reason) => run(() => api.extendTrial(userId, { days: wholeDays, reason }))}
      >
        <NumberField id="trial-days" label="Days" value={days} onChange={setDays} max={grantCap} hint={grantCap ? `Up to ${grantCap} days from today for your role.` : undefined} />
      </ActionDialog>
    )
  }

  if (kind === 'hold') {
    return (
      <ActionDialog
        title="Erasure hold"
        submitLabel="Set hold"
        description="Stops the retention job from erasing this lapsed account for a while. It changes nothing about what the customer can do."
        canSubmit={daysValid}
        onCancel={cancel}
        onSubmit={(reason) => run(() => api.setErasureHold(userId, { days: wholeDays, reason }))}
      >
        <NumberField id="hold-days" label="Days" value={days} onChange={setDays} max={holdCap} hint={holdCap ? `Up to ${holdCap} days for your role.` : undefined} />
      </ActionDialog>
    )
  }

  if (kind === 'grandfather') {
    return (
      <ActionDialog
        title="Grandfather this subscriber"
        submitLabel="Set grandfather"
        description="Marks this subscriber as pre-paywall, outside the ordinary billing lifecycle. It has no expiry and stays until cleared."
        onCancel={cancel}
        onSubmit={(reason) => run(() => api.setGrandfather(userId, { kind: grandfatherKind, reason }))}
      >
        <Field label="Kind" htmlFor="grandfather-kind">
          <select id="grandfather-kind" className={inputClass} value={grandfatherKind} onChange={(event) => setGrandfatherKind(event.target.value)}>
            {grandfatherKinds.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      </ActionDialog>
    )
  }

  if (kind === 'revokeGrandfather') {
    return (
      <ActionDialog
        title="Clear grandfather"
        submitLabel="Clear grandfather"
        variant="danger"
        description="Removes the grandfather status. The subscriber returns to the ordinary billing lifecycle."
        onCancel={cancel}
        onSubmit={(reason) => run(() => api.revokeGrandfather(userId, { reason }))}
      />
    )
  }

  if (kind === 'revoke') {
    return (
      <ActionDialog
        title="Revoke grant"
        submitLabel="Revoke grant"
        variant="danger"
        description="Removes the grant now. Access it was giving stops immediately."
        onCancel={cancel}
        onSubmit={(reason) => run(() => api.revokeGrant(userId, { reason }))}
      />
    )
  }

  return (
    <ActionDialog
      title="Clear erasure hold"
      submitLabel="Clear hold"
      description="The retention window restarts from today once the hold is gone."
      onCancel={cancel}
      onSubmit={(reason) => run(() => api.clearErasureHold(userId, { reason }))}
    />
  )
}

const SubscriberDetailPage = () => {
  const { userId = '' } = useParams()
  const { hasCapability } = useAuth()
  const detail = useAsync(() => api.getSubscriber(userId), [userId])
  const meta = useAsync(() => api.meta(), [])
  const [dialog, setDialog] = useState<DialogKind | null>(null)

  if (detail.error && !detail.data) {
    return (
      <>
        <BackLink />
        <ErrorAlert message={detail.error} />
      </>
    )
  }
  if (!detail.data) {
    return (
      <>
        <BackLink />
        <Spinner />
      </>
    )
  }

  const data = detail.data
  const sub = data.subscription
  const canGrant = hasCapability('grants.write')
  const canGrandfather = hasCapability('grandfather.write')

  return (
    <>
      <BackLink />
      <div>
        <h1 className="text-lg font-semibold">Subscriber</h1>
        <p className="font-mono text-xs text-text-muted">{data.account.userId}</p>
      </div>

      <WriteBanner readOnly={data.readOnly} />
      <ErrorAlert message={detail.error} />

      {canGrant ? (
        <div className="flex flex-wrap gap-2" aria-label="Actions" role="group">
          <Button onClick={() => setDialog('comp')}>Comp</Button>
          <Button onClick={() => setDialog('override')}>Plan override</Button>
          <Button onClick={() => setDialog('trial')}>Extend trial</Button>
          <Button onClick={() => setDialog('hold')}>Erasure hold</Button>
          {sub?.adminGrant ? <Button onClick={() => setDialog('revoke')}>Revoke grant</Button> : null}
          {sub?.retentionHoldUntil ? <Button onClick={() => setDialog('clearHold')}>Clear hold</Button> : null}
        </div>
      ) : null}

      {canGrandfather ? (
        <div className="flex flex-wrap gap-2" aria-label="Grandfather actions" role="group">
          <Button onClick={() => setDialog('grandfather')}>Grandfather</Button>
          {sub?.grandfatherKind ? <Button onClick={() => setDialog('revokeGrandfather')}>Clear grandfather</Button> : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Account">
          <Facts
            rows={[
              ['Email', data.account.email],
              ['Created', formatDate(data.account.createdAt)],
              ['Email verified', yesNo(data.account.isEmailVerified)],
              ['Terms accepted', `${data.legal.termsVersion ?? '-'} on ${formatDate(data.legal.acceptedAt)}`],
              ['Privacy version', data.legal.privacyVersion ?? '-'],
              ['Age attested', yesNo(data.legal.ageAttested)],
            ]}
          />
        </Section>

        <Section title="Subscription">
          {sub ? (
            <Facts
              rows={[
                ['Plan', sub.planCode],
                ['Stored status', <Badge key="s" tone={statusTone(sub.status)}>{humanize(sub.status)}</Badge>],
                ['Trial ends', formatDateTime(sub.trialEndsAt)],
                ['Period ends', formatDateTime(sub.currentPeriodEnd)],
                ['Cancels at period end', bool(sub.cancelAtPeriodEnd)],
                ['Past due since', formatDateTime(sub.pastDueSince)],
                ['Dunning stage', humanize(sub.dunningStage)],
                ['Lapsed at', formatDateTime(sub.lapsedAt)],
                ['Retention stage', humanize(sub.retentionStage)],
                ['Grandfathered', humanize(sub.grandfatherKind)],
                ['Admin grant', sub.adminGrant ? `${humanize(sub.adminGrant.kind)}${sub.adminGrant.planCode ? ` (${sub.adminGrant.planCode})` : ''} until ${formatDateTime(sub.adminGrant.until)}` : '-'],
                ['Erasure hold until', formatDateTime(sub.retentionHoldUntil)],
                ['Provider customer', sub.providerCustomerId ?? '-'],
                ['Provider subscription', sub.providerSubscriptionId ?? '-'],
                ['Last provider event', formatDateTime(sub.lastEventAt)],
              ]}
            />
          ) : (
            <p className="text-sm text-text-muted">Nothing is stored for this account yet.</p>
          )}
        </Section>

        <Section title="Entitlements">
          <Facts
            rows={[
              ['Resolved status', <Badge key="e" tone={statusTone(data.entitlements.status)}>{humanize(data.entitlements.status)}</Badge>],
              ['Plan', data.entitlements.planCode ?? '-'],
              ['Can write', bool(data.entitlements.canWrite)],
              ['Can push sync', bool(data.entitlements.canSyncPush)],
              ['Writable until', data.entitlements.writableUntil ? `${formatDateTime(data.entitlements.writableUntil)} (${relativeDays(data.entitlements.writableUntil)})` : '-'],
              ['Grace ends', formatDateTime(data.entitlements.graceEndsAt)],
              ['Features', Object.entries(data.entitlements.features).filter(([, on]) => on).map(([name]) => humanize(name)).join(', ') || 'none'],
              ['Billing', data.entitlements.billingEnabled ? 'enabled on this server' : 'off on this server'],
            ]}
          />
        </Section>

        <Section title="Usage">
          <Facts
            rows={[
              ['Receipt storage', `${formatBytes(data.usage.receiptBytes.used)} of ${formatLimit(data.usage.receiptBytes.limit, formatBytes)}`],
              ['Sync devices', `${data.usage.syncDevices.used} of ${formatLimit(data.usage.syncDevices.limit)}`],
              ['Largest workspace', `${data.usage.workspaceMembers.used} seats of ${formatLimit(data.usage.workspaceMembers.limit)}`],
            ]}
          />
        </Section>
      </div>

      <Section title="Devices">
        {data.devices.length === 0 ? (
          <p className="text-sm text-text-muted">No devices have synced.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="py-1 pr-4 font-medium">Ref</th>
                <th className="py-1 pr-4 font-medium">Kind</th>
                <th className="py-1 pr-4 font-medium">First seen</th>
                <th className="py-1 pr-4 font-medium">Last seen</th>
                <th className="py-1 font-medium">Can push</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.devices.map((device) => (
                <tr key={device.deviceRef + device.firstSeenAt}>
                  <td className="py-1 pr-4 font-mono text-xs">{device.deviceRef}</td>
                  <td className="py-1 pr-4">{device.kind ?? 'unknown'}</td>
                  <td className="py-1 pr-4">{formatDate(device.firstSeenAt)}</td>
                  <td className="py-1 pr-4">{formatDate(device.lastSeenAt)}</td>
                  <td className="py-1">{bool(device.canPush)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Workspaces">
        {data.workspaces.length === 0 ? (
          <p className="text-sm text-text-muted">Owns no workspaces.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.workspaces.map((workspace) => (
              <li key={workspace.id}>
                <span className="font-mono text-xs">{workspace.id}</span> - {workspace.seatCount} {workspace.seatCount === 1 ? 'member' : 'members'}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Billing events">
        {data.billingEvents.length === 0 ? (
          <p className="text-sm text-text-muted">No ledger events for this subscriber.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="py-1 pr-4 font-medium">When</th>
                <th className="py-1 pr-4 font-medium">Event</th>
                <th className="py-1 pr-4 font-medium">Outcome</th>
                <th className="py-1 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.billingEvents.map((event) => (
                <tr key={event.id}>
                  <td className="py-1 pr-4 whitespace-nowrap">{formatDateTime(event.occurredAt)}</td>
                  <td className="py-1 pr-4">{event.type}</td>
                  <td className="py-1 pr-4">{event.error ? <Badge tone="bad">{event.error}</Badge> : event.processedAt ? <Badge tone="good">applied</Badge> : <Badge tone="warn">pending</Badge>}</td>
                  <td className="py-1 text-xs text-text-muted">{event.redacted ? 'provider ids removed. ' : ''}{payloadSummary(event.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Erasure">
        <Facts
          rows={[
            ['Retention job', data.erasure.retentionEnabled ? `on, ${data.erasure.retentionDays}-day window` : 'off, nothing will be erased'],
            ['Lapsed at', formatDateTime(data.erasure.lapsedAt)],
            ['Projected erasure', data.erasure.projectedEraseAt ? `${formatDate(data.erasure.projectedEraseAt)} (${relativeDays(data.erasure.projectedEraseAt)})` : '-'],
            ['Last notice', `${humanize(data.erasure.lastNoticeStage)} on ${formatDate(data.erasure.lastNoticeAt)}`],
            ['Paused by a hold or comp', bool(data.erasure.held)],
          ]}
        />
      </Section>

      <Section title="History">
        {data.adminHistory.length === 0 ? (
          <p className="text-sm text-text-muted">No staff actions recorded.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {data.adminHistory.map((entry) => (
              <li key={entry.id} className="py-2">
                <span className="font-medium">{humanize(entry.action)}</span>{' '}
                <span className="text-text-muted">
                  {formatDateTime(entry.at)}
                  {entry.adminRole ? `, ${entry.adminRole}` : ''}
                </span>
                {entry.reason ? <p className="text-text-muted">{entry.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {dialog ? (
        <Dialogs
          key={dialog}
          kind={dialog}
          userId={userId}
          detail={data}
          meta={meta.data}
          cancel={() => setDialog(null)}
          done={() => {
            setDialog(null)
            detail.reload()
          }}
        />
      ) : null}
    </>
  )
}

const BackLink = () => (
  <Link to="/subscribers" className="text-sm text-text-muted underline">
    Back to subscribers
  </Link>
)

export default SubscriberDetailPage
