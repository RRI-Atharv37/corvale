import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StepUpProvider, useStepUp } from '../../components/StepUp'
import * as apiModule from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: { ...actual.api, stepUp: vi.fn() } }
})

const STEP_UP_REQUIRED = new apiModule.ApiError(apiModule.STEP_UP_REQUIRED_MESSAGE, 403)

const Harness = ({ action, onDone, onError }: { action: () => Promise<string>; onDone: (value: string) => void; onError: (error: unknown) => void }) => {
  const { run } = useStepUp()
  return <button onClick={() => run(action).then(onDone, onError)}>Do the thing</button>
}

const renderHarness = (action: () => Promise<string>) => {
  const onDone = vi.fn()
  const onError = vi.fn()
  render(
    <StepUpProvider>
      <Harness action={action} onDone={onDone} onError={onError} />
    </StepUpProvider>
  )
  return { onDone, onError }
}

beforeEach(() => {
  vi.mocked(apiModule.api.stepUp).mockReset().mockResolvedValue({ stepUpUntil: '2030-01-01T00:00:00.000Z' })
})

describe('step-up guard', () => {
  it('runs the action straight away when no step-up is needed', async () => {
    const action = vi.fn().mockResolvedValue('done')
    const { onDone } = renderHarness(action)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Do the thing' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('done'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(apiModule.api.stepUp).not.toHaveBeenCalled()
  })

  it('asks for an authenticator code when the server wants one, then retries the action once', async () => {
    const action = vi.fn().mockRejectedValueOnce(STEP_UP_REQUIRED).mockResolvedValueOnce('done')
    const { onDone } = renderHarness(action)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Do the thing' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/confirm/i)
    await user.type(screen.getByLabelText(/authenticator code/i), '654321')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('done'))
    expect(apiModule.api.stepUp).toHaveBeenCalledWith('654321')
    expect(action).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a wrong code inside the dialog and lets the admin try again', async () => {
    vi.mocked(apiModule.api.stepUp).mockRejectedValueOnce(new apiModule.ApiError('The authenticator code is not valid', 401))
    const action = vi.fn().mockRejectedValueOnce(STEP_UP_REQUIRED).mockResolvedValueOnce('done')
    const { onDone } = renderHarness(action)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Do the thing' }))
    await user.type(await screen.findByLabelText(/authenticator code/i), '000000')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i)
    expect(action).toHaveBeenCalledTimes(1)
    await user.clear(screen.getByLabelText(/authenticator code/i))
    await user.type(screen.getByLabelText(/authenticator code/i), '111111')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('done'))
  })

  it('rejects the action when the admin cancels, and never retries it', async () => {
    const action = vi.fn().mockRejectedValue(STEP_UP_REQUIRED)
    const { onError } = renderHarness(action)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Do the thing' }))
    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not ask for a code when the failure is a different one, and passes the error through', async () => {
    const other = new apiModule.ApiError('Your admin role does not allow this', 403)
    const { onError } = renderHarness(vi.fn().mockRejectedValue(other))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Do the thing' }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith(other))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('explains the 24-hour block instead of asking for a code that would be refused', async () => {
    const blocked = new apiModule.ApiError(apiModule.STEP_UP_DISABLED_MESSAGE, 403)
    const { onError } = renderHarness(vi.fn().mockRejectedValue(blocked))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Do the thing' }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith(blocked))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
