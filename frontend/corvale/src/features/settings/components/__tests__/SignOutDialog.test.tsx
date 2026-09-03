import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, userEvent } from '@/test/test-utils'

import SignOutDialog from '../SignOutDialog'

const baseProps = {
    open: true,
    unsyncedCount: 2,
    syncing: false,
    onSyncAndSignOut: vi.fn(),
    onDiscardAndSignOut: vi.fn(),
    onCancel: vi.fn(),
}

describe('SignOutDialog (SEC-46)', () => {
    it('names the unsynced change count', () => {
        render(<SignOutDialog {...baseProps} unsyncedCount={2} />)
        expect(screen.getByText(/2 changes on this device have not synced/i)).toBeInTheDocument()
    })

    it('uses the singular for one change', () => {
        render(<SignOutDialog {...baseProps} unsyncedCount={1} />)
        expect(screen.getByText(/one change on this device has not synced/i)).toBeInTheDocument()
    })

    it('wires each button to its handler', async () => {
        const props = {
            ...baseProps,
            onSyncAndSignOut: vi.fn(),
            onDiscardAndSignOut: vi.fn(),
            onCancel: vi.fn(),
        }
        render(<SignOutDialog {...props} />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: /sync, then sign out/i }))
        await user.click(screen.getByRole('button', { name: /discard changes and sign out/i }))
        await user.click(screen.getByRole('button', { name: /^cancel$/i }))

        expect(props.onSyncAndSignOut).toHaveBeenCalledOnce()
        expect(props.onDiscardAndSignOut).toHaveBeenCalledOnce()
        expect(props.onCancel).toHaveBeenCalledOnce()
    })

    it('disables the actions while a sync is in flight', () => {
        render(<SignOutDialog {...baseProps} syncing />)
        expect(screen.getByRole('button', { name: /syncing/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /discard changes and sign out/i })).toBeDisabled()
    })

    it('renders nothing when closed', () => {
        render(<SignOutDialog {...baseProps} open={false} />)
        expect(screen.queryByText(/have not synced/i)).not.toBeInTheDocument()
    })
})
