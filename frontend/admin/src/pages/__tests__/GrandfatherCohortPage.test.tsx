import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StepUpProvider } from '../../components/StepUp'
import * as apiModule from '../../lib/api'
import type { GrandfatherBatchView } from '../../lib/types'
import GrandfatherCohortPage from '../GrandfatherCohortPage'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listGrandfatherBatches: vi.fn(),
      previewGrandfatherCohort: vi.fn(),
      applyGrandfatherCohort: vi.fn(),
      revertGrandfatherCohort: vi.fn(),
      stepUp: vi.fn(),
    },
  }
})

const STEP_UP_REQUIRED = new apiModule.ApiError(apiModule.STEP_UP_REQUIRED_MESSAGE, 403)

const renderPage = () =>
  render(
    <StepUpProvider>
      <GrandfatherCohortPage />
    </StepUpProvider>
  )

const batch = (over: Partial<GrandfatherBatchView> = {}): GrandfatherBatchView => ({
  id: 'b1',
  kind: 'free_forever',
  registeredBefore: '2026-01-01T00:00:00.000Z',
  reason: 'Pre-paywall cohort',
  status: 'applied',
  count: 2,
  createdBy: 'a1',
  createdAt: '2026-09-01T00:00:00.000Z',
  revertedBy: null,
  revertedAt: null,
  revertReason: null,
  ...over,
})

beforeEach(() => {
  vi.mocked(apiModule.api.listGrandfatherBatches).mockReset().mockResolvedValue({ batches: [] })
  vi.mocked(apiModule.api.previewGrandfatherCohort).mockReset()
  vi.mocked(apiModule.api.applyGrandfatherCohort).mockReset()
  vi.mocked(apiModule.api.revertGrandfatherCohort).mockReset()
  vi.mocked(apiModule.api.stepUp).mockReset().mockResolvedValue({ stepUpUntil: '2030-01-01T00:00:00.000Z' })
})

describe('preview', () => {
  it('is disabled until a cutoff date is chosen', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: 'Preview' })).toBeDisabled()
  })

  it('shows the count and masked sample from the server', async () => {
    vi.mocked(apiModule.api.previewGrandfatherCohort).mockResolvedValue({ kind: 'free_forever', registeredBefore: '2026-01-01T00:00:00.000Z', count: 2, sample: ['j***@example.com'] })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Registered before'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(apiModule.api.previewGrandfatherCohort).toHaveBeenCalledWith({ kind: 'free_forever', registeredBefore: new Date('2026-01-01').toISOString() })
    expect(await screen.findByText('2', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/j\*\*\*@example\.com/)).toBeInTheDocument()
  })

  it('shows the server error and offers no apply button when the preview fails', async () => {
    vi.mocked(apiModule.api.previewGrandfatherCohort).mockRejectedValue(new apiModule.ApiError('The cohort criteria are not valid', 400))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Registered before'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i)
    expect(screen.queryByRole('button', { name: /apply to this cohort/i })).not.toBeInTheDocument()
  })
})

describe('apply', () => {
  const setUpPreview = async () => {
    vi.mocked(apiModule.api.previewGrandfatherCohort).mockResolvedValue({ kind: 'free_forever', registeredBefore: '2026-01-01T00:00:00.000Z', count: 2, sample: ['j***@example.com'] })
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Registered before'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByText(/subscribers match/i)
    return user
  }

  it('keeps submit disabled until the typed count matches the preview exactly', async () => {
    const user = await setUpPreview()
    await user.click(screen.getByRole('button', { name: /apply to this cohort/i }))
    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', { name: 'Apply' })

    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/type 2 to confirm/i), '1')
    expect(submit).toBeDisabled()
    await user.clear(within(dialog).getByLabelText(/type 2 to confirm/i))
    await user.type(within(dialog).getByLabelText(/type 2 to confirm/i), '2')
    await user.type(within(dialog).getByLabelText('Reason'), 'Pre-paywall cohort, decided at planning')
    expect(submit).toBeEnabled()
  })

  it('applies the cohort using the previewed kind and cutoff, then refreshes the batch list', async () => {
    vi.mocked(apiModule.api.applyGrandfatherCohort).mockResolvedValue({ batchId: 'b2', appliedCount: 2 })
    const user = await setUpPreview()

    await user.click(screen.getByRole('button', { name: /apply to this cohort/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/type 2 to confirm/i), '2')
    await user.type(within(dialog).getByLabelText('Reason'), 'Pre-paywall cohort, decided at planning')
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }))

    await waitFor(() =>
      expect(apiModule.api.applyGrandfatherCohort).toHaveBeenCalledWith({
        kind: 'free_forever',
        registeredBefore: '2026-01-01T00:00:00.000Z',
        confirmCount: 2,
        reason: 'Pre-paywall cohort, decided at planning',
      })
    )
    expect(await screen.findByText(/applied .* to 2 subscribers.*batch b2/i)).toBeInTheDocument()
    await waitFor(() => expect(apiModule.api.listGrandfatherBatches).toHaveBeenCalledTimes(2))
  })

  it('asks for a fresh authenticator code when the server requires a step-up', async () => {
    vi.mocked(apiModule.api.applyGrandfatherCohort).mockRejectedValueOnce(STEP_UP_REQUIRED).mockResolvedValueOnce({ batchId: 'b2', appliedCount: 2 })
    const user = await setUpPreview()

    await user.click(screen.getByRole('button', { name: /apply to this cohort/i }))
    const applyDialog = await screen.findByRole('dialog')
    await user.type(within(applyDialog).getByLabelText(/type 2 to confirm/i), '2')
    await user.type(within(applyDialog).getByLabelText('Reason'), 'Pre-paywall cohort, decided at planning')
    await user.click(within(applyDialog).getByRole('button', { name: 'Apply' }))

    const stepUpDialog = await screen.findByRole('dialog', { name: /confirm it is you/i })
    await user.type(within(stepUpDialog).getByLabelText(/authenticator code/i), '654321')
    await user.click(within(stepUpDialog).getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(apiModule.api.applyGrandfatherCohort).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/applied/i)).toBeInTheDocument()
  })
})

describe('batches and revert', () => {
  it('lists batches and only offers revert on an applied one', async () => {
    vi.mocked(apiModule.api.listGrandfatherBatches).mockResolvedValue({ batches: [batch({ id: 'b1', status: 'applied' }), batch({ id: 'b2', status: 'reverted' })] })
    renderPage()

    const rows = await screen.findAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Revert' })).toHaveLength(1)
  })

  it('reverts a batch and refreshes the list', async () => {
    vi.mocked(apiModule.api.listGrandfatherBatches).mockResolvedValue({ batches: [batch()] })
    vi.mocked(apiModule.api.revertGrandfatherCohort).mockResolvedValue({ batchId: 'b1', revertedCount: 2 })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Revert' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Reversing the earlier cohort decision')
    await user.click(within(dialog).getByRole('button', { name: 'Revert' }))

    await waitFor(() => expect(apiModule.api.revertGrandfatherCohort).toHaveBeenCalledWith('b1', { reason: 'Reversing the earlier cohort decision' }))
    expect(await screen.findByText(/reverted 2 subscribers/i)).toBeInTheDocument()
    await waitFor(() => expect(apiModule.api.listGrandfatherBatches).toHaveBeenCalledTimes(2))
  })
})
