import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiModule from '../../lib/api'
import type { GrandfatherCohortReport, MetricsOverview } from '../../lib/types'
import MetricsPage from '../MetricsPage'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      metricsOverview: vi.fn(),
      grandfatherCohortReport: vi.fn(),
    },
  }
})

const overview = (over: Partial<MetricsOverview> = {}): MetricsOverview => ({
  windowDays: 30,
  generatedAt: '2026-09-22T12:00:00.000Z',
  flows: {
    signups: 0,
    trialStarted: 0,
    trialConverted: 0,
    trialExpired: 0,
    newPaid: 0,
    newMrr: 0,
    expansionMrr: 0,
    contractionMrr: 0,
    churnedVoluntary: 0,
    churnedInvoluntary: 0,
    churnedMrr: 0,
    refunds: 0,
    refundMinor: 0,
    disputes: 0,
    pastDueEntered: 0,
    dunningRecovered: 0,
  },
  stock: null,
  movement: null,
  series: [],
  rates: { logoChurn: null, revenueChurn: null, trialConversionRate: null, dunningRecoveryRate: null },
  ltv: { status: 'insufficient_data', ltvMinor: null, lowMinor: null, highMinor: null, churnRate: null, churnEvents: 0, subscribersAtRisk: 0 },
  dataQuality: { daysRequested: 30, daysWithStock: 0 },
  ...over,
})

const cohortReport = (over: Partial<GrandfatherCohortReport> = {}): GrandfatherCohortReport => ({
  totalEverGrandfathered: 0,
  buckets: [
    { outcome: 'free_forever', count: 0, foregoneMrrMinor: 0 },
    { outcome: 'active_grant', count: 0, foregoneMrrMinor: 0 },
    { outcome: 'converted', count: 0, foregoneMrrMinor: 0 },
    { outcome: 'lapsed', count: 0, foregoneMrrMinor: 0 },
  ],
  ...over,
})

beforeEach(() => {
  vi.mocked(apiModule.api.metricsOverview).mockReset().mockResolvedValue(overview())
  vi.mocked(apiModule.api.grandfatherCohortReport).mockReset().mockResolvedValue(cohortReport())
})

describe('MetricsPage', () => {
  it('loads the default 30-day window on mount', async () => {
    render(<MetricsPage />)

    await waitFor(() => expect(apiModule.api.metricsOverview).toHaveBeenCalledWith(30))
    expect(await screen.findByText(/UTC calendar days/i)).toBeInTheDocument()
  })

  it('reloads with the chosen window when it changes', async () => {
    const user = userEvent.setup()
    render(<MetricsPage />)
    await waitFor(() => expect(apiModule.api.metricsOverview).toHaveBeenCalledWith(30))

    await user.selectOptions(screen.getByLabelText('Window'), '90')

    await waitFor(() => expect(apiModule.api.metricsOverview).toHaveBeenCalledWith(90))
  })

  it('shows a no-snapshot message rather than a chart when there is no stock yet', async () => {
    render(<MetricsPage />)

    expect(await screen.findByText(/no stock snapshot has landed/i)).toBeInTheDocument()
    expect(screen.getByText(/needs two stock snapshots/i)).toBeInTheDocument()
  })

  it('renders MRR, movement reconciliation and rates once stock and movement are present', async () => {
    vi.mocked(apiModule.api.metricsOverview).mockResolvedValue(
      overview({
        stock: {
          asOf: '2026-09-22T00:00:00.000Z',
          segments: [{ planCode: 'pro', status: 'active', interval: 'monthly', grandfatherKind: null, count: 10 }],
          listPriceMrrMinor: 120000,
          atRiskMrrMinor: 0,
          payingSubscribers: 10,
          arpaMinor: 12000,
        },
        movement: {
          startMrrMinor: 100000,
          endMrrMinor: 120000,
          newMrrMinor: 25000,
          expansionMrrMinor: 0,
          contractionMrrMinor: 0,
          churnedMrrMinor: 5000,
          expectedDeltaMinor: 20000,
          actualDeltaMinor: 20000,
          residualMinor: 0,
        },
        series: [
          { date: '2026-09-18', mrrMinor: 100000, atRiskMrrMinor: 0 },
          { date: '2026-09-22', mrrMinor: 120000, atRiskMrrMinor: 0 },
        ],
        rates: { logoChurn: 0.05, revenueChurn: 0.04, trialConversionRate: 0.3, dunningRecoveryRate: 0.8 },
      })
    )

    render(<MetricsPage />)

    expect(await screen.findByText('1200.00')).toBeInTheDocument()
    expect(screen.getByText('reconciles')).toBeInTheDocument()
    expect(screen.getByText('5.0%')).toBeInTheDocument()
    expect(screen.getByText('pro')).toBeInTheDocument()
  })

  it('flags a nonzero residual instead of hiding it', async () => {
    vi.mocked(apiModule.api.metricsOverview).mockResolvedValue(
      overview({
        stock: {
          asOf: '2026-09-22T00:00:00.000Z',
          segments: [],
          listPriceMrrMinor: 120000,
          atRiskMrrMinor: 0,
          payingSubscribers: 10,
          arpaMinor: 12000,
        },
        movement: {
          startMrrMinor: 100000,
          endMrrMinor: 122000,
          newMrrMinor: 20000,
          expansionMrrMinor: 0,
          contractionMrrMinor: 0,
          churnedMrrMinor: 0,
          expectedDeltaMinor: 20000,
          actualDeltaMinor: 22000,
          residualMinor: 2000,
        },
        series: [
          { date: '2026-09-18', mrrMinor: 100000, atRiskMrrMinor: 0 },
          { date: '2026-09-22', mrrMinor: 122000, atRiskMrrMinor: 0 },
        ],
      })
    )

    render(<MetricsPage />)

    expect(await screen.findByText('residual')).toBeInTheDocument()
  })

  it('shows the grandfather cohort report with per-outcome counts and foregone value', async () => {
    vi.mocked(apiModule.api.grandfatherCohortReport).mockResolvedValue(
      cohortReport({
        totalEverGrandfathered: 3,
        buckets: [
          { outcome: 'free_forever', count: 2, foregoneMrrMinor: 2400 },
          { outcome: 'active_grant', count: 0, foregoneMrrMinor: 0 },
          { outcome: 'converted', count: 1, foregoneMrrMinor: 0 },
          { outcome: 'lapsed', count: 0, foregoneMrrMinor: 0 },
        ],
      })
    )

    render(<MetricsPage />)

    expect(await screen.findByText(/3 total/i)).toBeInTheDocument()
    expect(screen.getByText('Free forever')).toBeInTheDocument()
    expect(screen.getByText('24.00')).toBeInTheDocument()
  })

  it('always renders the definitions and known-limits panel', async () => {
    render(<MetricsPage />)

    expect(await screen.findByText(/Collected cash revenue/i)).toBeInTheDocument()
    expect(screen.getByText(/never a realised figure/i)).toBeInTheDocument()
  })
})
