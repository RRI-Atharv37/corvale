import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiModule from '../../lib/api'
import SubscribersPage from '../SubscribersPage'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: { ...actual.api, lookup: vi.fn(), listSubscribers: vi.fn(), meta: vi.fn() } }
})

const item = (over: Record<string, unknown> = {}) => ({
  userId: '65f000000000000000000001',
  email: 'j***@example.com',
  planCode: 'pro',
  status: 'active',
  resolvedStatus: 'active',
  canWrite: true,
  trialEndsAt: null,
  currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  pastDueSince: null,
  dunningStage: null,
  retentionStage: null,
  grandfatherKind: null,
  hasAdminGrant: false,
  onRetentionHold: false,
  providerLinked: true,
  providerSubscriptionId: '…654321',
  lastEventAt: null,
  ...over,
})

const META = {
  plans: ['plus', 'pro'],
  statuses: ['trialing', 'active', 'past_due', 'trial_expired', 'cancelled'],
  grandfatherKinds: ['free_forever', 'locked_rate', 'extended_trial'],
  dunningStages: ['payment_failed'],
  retentionStages: ['notice'],
  grantKinds: ['comp', 'plan_override'],
  roles: ['support', 'finance', 'owner'],
  caps: { grantDays: 30, erasureHoldDays: 30 },
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/subscribers']}>
      <Routes>
        <Route path="/subscribers" element={<SubscribersPage />} />
        <Route path="/subscribers/:userId" element={<p>Detail page</p>} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  vi.mocked(apiModule.api.meta).mockReset().mockResolvedValue(META as never)
  vi.mocked(apiModule.api.lookup).mockReset().mockResolvedValue({ subscribers: [] })
  vi.mocked(apiModule.api.listSubscribers)
    .mockReset()
    .mockResolvedValue({ subscribers: [item(), item({ userId: '65f000000000000000000002', email: 'k***@example.com', status: 'past_due', resolvedStatus: 'past_due' })], total: 2, page: 1, limit: 25 })
})

describe('SubscribersPage', () => {
  it('lists subscribers with masked emails and masked provider ids, and the derived status', async () => {
    renderPage()

    expect(await screen.findByText('j***@example.com')).toBeInTheDocument()
    expect(screen.getByText('k***@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('…654321').length).toBe(2)
    expect(screen.getByText(/2 subscribers/i)).toBeInTheDocument()
  })

  it('says plainly that search is exact and what it accepts', async () => {
    renderPage()

    expect(await screen.findByText(/exact/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/find a subscriber/i)).toHaveAttribute('placeholder', expect.stringMatching(/email|id/i))
  })

  it('looks a subscriber up by exact value and links to the detail page', async () => {
    vi.mocked(apiModule.api.lookup).mockResolvedValue({ subscribers: [item()] })
    const user = userEvent.setup()
    renderPage()

    await user.type(await screen.findByLabelText(/find a subscriber/i), '  jane.doe@example.com ')
    await user.click(screen.getByRole('button', { name: /^find$/i }))

    await waitFor(() => expect(apiModule.api.lookup).toHaveBeenCalledWith('jane.doe@example.com'))
    const result = await screen.findByRole('region', { name: /lookup result/i })
    await user.click(within(result).getByRole('link', { name: /j\*\*\*@example\.com/ }))
    expect(await screen.findByText('Detail page')).toBeInTheDocument()
  })

  it('says nothing matched instead of showing an empty table', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(await screen.findByLabelText(/find a subscriber/i), 'nobody@example.com')
    await user.click(screen.getByRole('button', { name: /^find$/i }))

    expect(await screen.findByText(/no exact match/i)).toBeInTheDocument()
  })

  it('applies a filter and asks the server for it', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.selectOptions(await screen.findByLabelText('Status'), 'past_due')

    await waitFor(() => expect(apiModule.api.listSubscribers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'past_due', page: 1 })))
  })

  it('pages through the results', async () => {
    vi.mocked(apiModule.api.listSubscribers).mockResolvedValue({ subscribers: [item()], total: 60, page: 1, limit: 25 })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /next/i }))

    await waitFor(() => expect(apiModule.api.listSubscribers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
  })

  it('shows an error state when the list cannot be loaded', async () => {
    vi.mocked(apiModule.api.listSubscribers).mockRejectedValue(new apiModule.ApiError('Your admin role does not allow this', 403))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not allow this/i)
  })
})
