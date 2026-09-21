import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import DeviceList from '../components/DeviceList'
import type { SyncDevice } from '../types'
import { device } from './fixtures'

const setup = (props: Partial<React.ComponentProps<typeof DeviceList>> = {}) => {
    const onRevoke = vi.fn().mockResolvedValue(true)
    const onRename = vi.fn().mockResolvedValue(true)
    const devices: SyncDevice[] = props.devices ?? [
        device({ deviceId: 'desk', kind: 'desktop', current: true }),
        device({ deviceId: 'phone', kind: 'pwa', canPush: false, lastSeenAt: '2026-04-11T09:00:00.000Z' }),
    ]
    render(
        <DeviceList devices={devices} limit={1} loading={false} error={null} busy={false} onRevoke={onRevoke} onRename={onRename} {...props} />
    )
    return { onRevoke, onRename, user: userEvent.setup() }
}

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem')

describe('the list', () => {
    it('is a labelled region with one row per device, named by kind when unnamed', () => {
        setup()

        expect(screen.getByRole('region', { name: /sync devices/i })).toBeInTheDocument()
        expect(rows()).toHaveLength(2)
        expect(rows()[0]).toHaveTextContent('Desktop app')
        expect(rows()[1]).toHaveTextContent('Installed web app')
    })

    it('shows the name the user gave a device instead of its kind', () => {
        setup({ devices: [device({ deviceId: 'a', name: 'Work laptop', kind: 'desktop' })] })

        expect(rows()[0]).toHaveTextContent('Work laptop')
        expect(rows()[0]).not.toHaveTextContent('Desktop app')
    })

    it('shows when each device was added and last synced, and never an id', () => {
        setup({ devices: [device({ deviceId: 'a1b2c3d4-secret-id', firstSeenAt: '2026-03-01T09:00:00.000Z', lastSeenAt: '2026-04-10T09:00:00.000Z' })] })

        expect(rows()[0]).toHaveTextContent(/added mar 1, 2026/i)
        expect(rows()[0]).toHaveTextContent(/last synced apr 10, 2026/i)
        expect(screen.queryByText(/a1b2c3d4-secret-id/)).not.toBeInTheDocument()
    })

    it('marks this device', () => {
        setup()

        expect(within(rows()[0]).getByText(/this device/i)).toBeInTheDocument()
        expect(within(rows()[1]).queryByText(/this device/i)).not.toBeInTheDocument()
    })

    it('says which device is download-only under the plan limit, and does not say it of the others', () => {
        setup()

        expect(within(rows()[1]).getByText(/download only/i)).toBeInTheDocument()
        expect(within(rows()[0]).queryByText(/download only/i)).not.toBeInTheDocument()
    })

    it('states the plan limit, or that there is none', () => {
        const { unmount } = render(
            <DeviceList devices={[device()]} limit={1} loading={false} error={null} busy={false} onRevoke={vi.fn()} onRename={vi.fn()} />
        )
        expect(screen.getByText(/changes from 1 device\b/i)).toBeInTheDocument()
        unmount()

        render(<DeviceList devices={[device()]} limit={null} loading={false} error={null} busy={false} onRevoke={vi.fn()} onRename={vi.fn()} />)
        expect(screen.getByText(/any number of devices/i)).toBeInTheDocument()
    })

    it('explains that a removed device comes back at the end of the line if it syncs again', () => {
        setup()

        expect(screen.getByText(/syncs again/i)).toBeInTheDocument()
    })

    it.each([
        [{ loading: true, devices: null }, /loading devices/i],
        [{ error: 'boom', devices: null }, /could not load your devices/i],
        [{ devices: [] }, /no devices have synced yet/i],
    ] as const)('handles the %j state', (props, text) => {
        setup(props as Partial<React.ComponentProps<typeof DeviceList>>)

        expect(screen.getByText(text)).toBeInTheDocument()
    })
})

describe('removing a device', () => {
    it('offers Remove on every device except this one, because removing it would only re-add it', () => {
        setup()

        expect(screen.queryByRole('button', { name: /remove desktop app/i })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /remove installed web app/i })).toBeInTheDocument()
    })

    it('asks first, and does nothing until confirmed', async () => {
        const { user, onRevoke } = setup()

        await user.click(screen.getByRole('button', { name: /remove installed web app/i }))

        expect(onRevoke).not.toHaveBeenCalled()
        expect(screen.getByText(/remove installed web app from your devices\?/i)).toBeInTheDocument()
    })

    it('revokes the device that was confirmed', async () => {
        const { user, onRevoke } = setup()

        await user.click(screen.getByRole('button', { name: /remove installed web app/i }))
        await user.click(screen.getByRole('button', { name: /yes, remove/i }))

        expect(onRevoke).toHaveBeenCalledExactlyOnceWith('phone')
    })

    it('Keep backs out without revoking', async () => {
        const { user, onRevoke } = setup()

        await user.click(screen.getByRole('button', { name: /remove installed web app/i }))
        await user.click(screen.getByRole('button', { name: /^keep$/i }))

        expect(onRevoke).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: /remove installed web app/i })).toBeInTheDocument()
    })

    it('disables the actions while another request is in flight', () => {
        setup({ busy: true })

        expect(screen.getByRole('button', { name: /remove installed web app/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /rename installed web app/i })).toBeDisabled()
    })
})

describe('naming a device', () => {
    it('saves the trimmed text under that device', async () => {
        const { user, onRename } = setup()

        await user.click(screen.getByRole('button', { name: /rename installed web app/i }))
        await user.type(screen.getByRole('textbox', { name: /device name/i }), '  Kitchen tablet ')
        await user.click(screen.getByRole('button', { name: /^save$/i }))

        expect(onRename).toHaveBeenCalledExactlyOnceWith('phone', 'Kitchen tablet')
    })

    it('starts from the current name', async () => {
        const { user } = setup({ devices: [device({ deviceId: 'a', name: 'Work laptop' })] })

        await user.click(screen.getByRole('button', { name: /rename work laptop/i }))

        expect(screen.getByRole('textbox', { name: /device name/i })).toHaveValue('Work laptop')
    })

    it('saving an empty name clears it', async () => {
        const { user, onRename } = setup({ devices: [device({ deviceId: 'a', name: 'Work laptop' })] })

        await user.click(screen.getByRole('button', { name: /rename work laptop/i }))
        await user.clear(screen.getByRole('textbox', { name: /device name/i }))
        await user.click(screen.getByRole('button', { name: /^save$/i }))

        expect(onRename).toHaveBeenCalledExactlyOnceWith('a', null)
    })

    it('limits the field to the length the server accepts', async () => {
        const { user } = setup()

        await user.click(screen.getByRole('button', { name: /rename installed web app/i }))

        expect(screen.getByRole('textbox', { name: /device name/i })).toHaveAttribute('maxlength', '40')
    })

    it('Cancel closes the editor without saving', async () => {
        const { user, onRename } = setup()

        await user.click(screen.getByRole('button', { name: /rename installed web app/i }))
        await user.type(screen.getByRole('textbox', { name: /device name/i }), 'Nope')
        await user.click(screen.getByRole('button', { name: /^cancel$/i }))

        expect(onRename).not.toHaveBeenCalled()
        expect(screen.queryByRole('textbox', { name: /device name/i })).not.toBeInTheDocument()
    })

    it('can rename this device too', () => {
        setup()

        expect(screen.getByRole('button', { name: /rename desktop app/i })).toBeInTheDocument()
    })
})
