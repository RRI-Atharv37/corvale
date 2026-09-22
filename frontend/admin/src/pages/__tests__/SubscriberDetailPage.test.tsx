import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiModule from '../../lib/api'
import SubscriberDetailPage from '../SubscriberDetailPage'

let capabilities: string[] = []
let role: 'support' | 'finance' | 'owner' = 'support'

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    status: 'authenticated',
    admin: { id: 'a1', email: 'ops@example.com', role },
    hasCapability: (capability: string) => capabilities.includes(capability),
  }),
}))

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getSubscriber: vi.fn(),
      meta: vi.fn(),
      grant: vi.fn(),
      revokeGrant: vi.fn(),
      extendTrial: vi.fn(),
      setErasureHold: vi.fn(),
      clearErasureHold: vi.fn(),
      setGrandfather: vi.fn(),
      revokeGrandfather: vi.fn(),
    },
  }
})

const USER_ID = '65f000000000000000000001'

const detail = (over: Record<string, unknown> = {}) => ({
  account: { userId: USER_ID, email: 'jane.doe@example.com', createdAt: '2026-01-01T00:00:00.000Z', isEmailVerified: true },
  legal: { termsVersion: '2026-09', privacyVersion: '2026-09', acceptedAt: '2026-01-01T00:00:00.000Z', ageAttested: true },
  subscription: {
    id: 's1',
    planCode: 'pro',
    status: 'trial_expired',
    trialEndsAt: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    dunningStage: null,
    lapsedAt: '2026-09-01T00:00:00.000Z',
    retentionStage: 'notice',
    retentionStageAt: '2026-09-01T00:00:00.000Z',
    grandfatherKind: null,
    adminGrant: null,
    retentionHoldUntil: null,
    providerCustomerId: 'cus_123456789',
    providerSubscriptionId: 'sub_987654321',
    lastEventAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  entitlements: {
    billingEnabled: true,
    status: 'trial_expired',
    planCode: 'pro',
    canWrite: false,
    canSyncPush: false,
    features: { workspaces: true, prioritySupport: true, bankSync: false },
    limits: { receiptStorageBytes: 10485760, syncDevices: null, workspaceMembers: null },
    trialEndsAt: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    writableUntil: null,
  },
  readOnly: { canWrite: false, code: 'trial_expired', message: 'The free trial ended on 2026-09-01 and no plan was started. Everything can still be read and exported.' },
  usage: {
    receiptBytes: { used: 2048, limit: 10485760 },
    syncDevices: { used: 1, limit: null },
    workspaceMembers: { used: 2, limit: null },
  },
  devices: [{ deviceRef: 'abcdef01', kind: 'desktop', firstSeenAt: '2026-01-02T00:00:00.000Z', lastSeenAt: '2026-09-20T00:00:00.000Z', canPush: true }],
  workspaces: [{ id: 'w1', seatCount: 2 }],
  billingEvents: [{ id: 'e1', type: 'payment.succeeded', occurredAt: '2026-08-01T00:00:00.000Z', processedAt: '2026-08-01T00:00:01.000Z', error: null, redacted: false, payload: { total: 900, currency: 'USD' } }],
  erasure: { retentionEnabled: true, retentionDays: 180, lapsedAt: '2026-09-01T00:00:00.000Z', projectedEraseAt: '2027-02-28T00:00:00.000Z', lastNoticeStage: 'notice', lastNoticeAt: '2026-09-01T00:00:00.000Z', held: false },
  adminHistory: [{ id: 'h1', at: '2026-09-10T00:00:00.000Z', action: 'subscription.viewed', adminId: 'a1', adminRole: 'support', before: null, after: null, reason: null }],
  ...over,
})

const META = {
  plans: ['plus', 'pro'],
  statuses: [],
  grandfatherKinds: ['free_forever', 'locked_rate', 'extended_trial'],
  dunningStages: [],
  retentionStages: [],
  grantKinds: ['comp', 'plan_override'],
  roles: ['support', 'finance', 'owner'],
  caps: { grantDays: 30, erasureHoldDays: 30 },
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/subscribers/${USER_ID}`]}>
      <Routes>
        <Route path="/subscribers/:userId" element={<SubscriberDetailPage />} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  capabilities = ['subscribers.read', 'ops.read', 'grants.write', 'grandfather.write']
  role = 'support'
  vi.mocked(apiModule.api.getSubscriber).mockReset().mockResolvedValue(detail() as never)
  vi.mocked(apiModule.api.meta).mockReset().mockResolvedValue(META as never)
  for (const name of ['grant', 'revokeGrant', 'extendTrial', 'setErasureHold', 'clearErasureHold', 'setGrandfather', 'revokeGrandfather'] as const) {
    vi.mocked(apiModule.api[name]).mockReset().mockResolvedValue({} as never)
  }
})

describe('SubscriberDetailPage - what it shows', () => {
  it('renders every section the API returns', async () => {
    renderPage()

    for (const heading of ['Account', 'Subscription', 'Entitlements', 'Usage', 'Devices', 'Workspaces', 'Billing events', 'Erasure', 'History']) {
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    }
  })

  it('leads with the plain-language reason a customer is read-only', async () => {
    renderPage()

    const banner = await screen.findByRole('status', { name: /write access/i })
    expect(banner).toHaveTextContent(/free trial ended on 2026-09-01/i)
    expect(banner).toHaveTextContent(/read-only/i)
  })

  it('shows the full email and provider ids, which only the detail view carries', async () => {
    renderPage()

    expect(await screen.findByText('jane.doe@example.com')).toBeInTheDocument()
    expect(screen.getByText('cus_123456789')).toBeInTheDocument()
    expect(screen.getByText('sub_987654321')).toBeInTheDocument()
  })

  it('shows devices by short reference and kind only', async () => {
    renderPage()

    const devices = await screen.findByRole('region', { name: 'Devices' })
    expect(within(devices).getByText('abcdef01')).toBeInTheDocument()
    expect(within(devices).getByText(/desktop/i)).toBeInTheDocument()
  })

  it('shows usage against the limit, with unlimited spelled out', async () => {
    renderPage()

    const usage = await screen.findByRole('region', { name: 'Usage' })
    expect(within(usage).getByText(/2\.0 KB/)).toBeInTheDocument()
    expect(within(usage).getAllByText(/unlimited/i).length).toBeGreaterThan(0)
  })

  it('shows a subscriber with no subscription row without crashing', async () => {
    vi.mocked(apiModule.api.getSubscriber).mockResolvedValue(
      detail({ subscription: null, readOnly: { canWrite: false, code: 'no_subscription', message: 'This account has no subscription record, so it is read-only. Everything can still be read and exported.' } }) as never
    )
    renderPage()

    expect(await screen.findByText(/no subscription record/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /comp/i })).toBeInTheDocument()
  })

  it('shows an error state, not a blank page, when the load fails', async () => {
    vi.mocked(apiModule.api.getSubscriber).mockRejectedValue(new apiModule.ApiError('Too many subscriber detail views this hour', 429))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many subscriber detail views/i)
  })
})

describe('SubscriberDetailPage - actions', () => {
  it('offers no actions to a role without grants.write', async () => {
    capabilities = ['subscribers.read', 'ops.read']
    role = 'finance'
    renderPage()

    await screen.findByRole('heading', { name: 'Account' })

    for (const name of [/comp/i, /override/i, /extend trial/i, /erasure hold/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('keeps the submit button disabled until the reason is long enough, and warns against customer details', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^comp/i }))
    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', { name: /grant comp/i })

    expect(within(dialog).getByText(/do not (put|include) .*email/i)).toBeInTheDocument()
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Reason'), 'short')
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Reason'), ' but now long enough')
    expect(submit).toBeEnabled()
  })

  it('blocks a reason that contains an email address before it reaches the server', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^comp/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Requested by jane@example.com today')

    expect(within(dialog).getByRole('button', { name: /grant comp/i })).toBeDisabled()
    expect(within(dialog).getByText(/email address/i)).toBeInTheDocument()
  })

  it('grants a comp with the chosen plan and days, then reloads the subscriber', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^comp/i }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Plan'), 'pro')
    await user.clear(within(dialog).getByLabelText('Days'))
    await user.type(within(dialog).getByLabelText('Days'), '14')
    await user.type(within(dialog).getByLabelText('Reason'), 'Goodwill after the billing outage')
    await user.click(within(dialog).getByRole('button', { name: /grant comp/i }))

    await waitFor(() =>
      expect(apiModule.api.grant).toHaveBeenCalledWith(USER_ID, { kind: 'comp', planCode: 'pro', days: 14, reason: 'Goodwill after the billing outage' })
    )
    await waitFor(() => expect(apiModule.api.getSubscriber).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('caps the days field at what the role may grant', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^comp/i }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByLabelText('Days')).toHaveAttribute('max', '30')
  })

  it('shows the server error inside the dialog and keeps it open', async () => {
    vi.mocked(apiModule.api.grant).mockRejectedValue(new apiModule.ApiError('That duration is above the cap for your role', 400))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^comp/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Goodwill after the billing outage')
    await user.click(within(dialog).getByRole('button', { name: /grant comp/i }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/above the cap/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('extends a trial and sets an erasure hold through their own dialogs', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /extend trial/i }))
    let dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Trial lost to a sync bug last week')
    await user.click(within(dialog).getByRole('button', { name: /extend trial/i }))
    await waitFor(() => expect(apiModule.api.extendTrial).toHaveBeenCalledWith(USER_ID, { days: 7, reason: 'Trial lost to a sync bug last week' }))

    await user.click(await screen.findByRole('button', { name: /erasure hold/i }))
    dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Customer asked for more time to decide')
    await user.click(within(dialog).getByRole('button', { name: /set hold/i }))
    await waitFor(() => expect(apiModule.api.setErasureHold).toHaveBeenCalledWith(USER_ID, { days: 14, reason: 'Customer asked for more time to decide' }))
  })

  it('offers to revoke an existing grant and to clear an existing hold', async () => {
    vi.mocked(apiModule.api.getSubscriber).mockResolvedValue(
      detail({
        subscription: { ...detail().subscription, adminGrant: { kind: 'comp', planCode: 'pro', until: '2026-12-01T00:00:00.000Z', limits: null, grantedBy: 'a1', grantedAt: '2026-09-10T00:00:00.000Z' }, retentionHoldUntil: '2026-11-01T00:00:00.000Z' },
      }) as never
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /revoke grant/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Issue resolved, no longer needed')
    await user.click(within(dialog).getByRole('button', { name: /^revoke grant/i }))

    await waitFor(() => expect(apiModule.api.revokeGrant).toHaveBeenCalledWith(USER_ID, { reason: 'Issue resolved, no longer needed' }))
    expect(screen.getByRole('button', { name: /clear hold/i })).toBeInTheDocument()
  })

  it('offers no grandfather action to a role without grandfather.write', async () => {
    capabilities = ['subscribers.read', 'ops.read', 'grants.write']
    renderPage()

    await screen.findByRole('heading', { name: 'Account' })

    expect(screen.queryByRole('button', { name: /^grandfather$/i })).not.toBeInTheDocument()
  })

  it('sets a grandfather kind, then reloads the subscriber', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^grandfather$/i }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Kind'), 'free_forever')
    await user.type(within(dialog).getByLabelText('Reason'), 'Early adopter, pre-paywall cohort')
    await user.click(within(dialog).getByRole('button', { name: /set grandfather/i }))

    await waitFor(() => expect(apiModule.api.setGrandfather).toHaveBeenCalledWith(USER_ID, { kind: 'free_forever', reason: 'Early adopter, pre-paywall cohort' }))
    await waitFor(() => expect(apiModule.api.getSubscriber).toHaveBeenCalledTimes(2))
  })

  it('offers to clear an existing grandfather kind', async () => {
    vi.mocked(apiModule.api.getSubscriber).mockResolvedValue(detail({ subscription: { ...detail().subscription, grandfatherKind: 'free_forever' } }) as never)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /clear grandfather/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'No longer applicable, converted to a paid plan')
    await user.click(within(dialog).getByRole('button', { name: /^clear grandfather/i }))

    await waitFor(() => expect(apiModule.api.revokeGrandfather).toHaveBeenCalledWith(USER_ID, { reason: 'No longer applicable, converted to a paid plan' }))
  })
})
