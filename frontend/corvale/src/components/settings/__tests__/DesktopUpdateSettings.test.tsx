import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, userEvent } from '../../../test/test-utils'

const mockIsTauriRuntime = vi.fn()
const mockCheckForDesktopUpdate = vi.fn()
const mockInstallPendingUpdate = vi.fn()
const mockGetInstalledVersion = vi.fn()

vi.mock('../../../desktop/isTauri', () => ({
    isTauriRuntime: () => mockIsTauriRuntime(),
}))

vi.mock('../../../desktop/updater', () => ({
    checkForDesktopUpdate: (...args: unknown[]) => mockCheckForDesktopUpdate(...args),
    installPendingUpdate: (...args: unknown[]) => mockInstallPendingUpdate(...args),
    getInstalledVersion: (...args: unknown[]) => mockGetInstalledVersion(...args),
}))

const { default: DesktopUpdateSettings } = await import('../DesktopUpdateSettings')

beforeEach(() => {
    mockIsTauriRuntime.mockReturnValue(true)
    mockGetInstalledVersion.mockResolvedValue('1.0.0')
    mockCheckForDesktopUpdate.mockResolvedValue({ available: false })
    mockInstallPendingUpdate.mockResolvedValue(undefined)
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('DesktopUpdateSettings (V15)', () => {
    it('renders nothing outside the Tauri desktop shell', () => {
        mockIsTauriRuntime.mockReturnValue(false)
        const { container } = render(<DesktopUpdateSettings />)
        expect(container).toBeEmptyDOMElement()
        expect(mockGetInstalledVersion).not.toHaveBeenCalled()
    })

    it('shows the currently-installed version', async () => {
        render(<DesktopUpdateSettings />)
        expect(await screen.findByText(/1\.0\.0/)).toBeInTheDocument()
    })

    it('reports when the app is already on the latest version', async () => {
        const user = userEvent.setup()
        render(<DesktopUpdateSettings />)
        await screen.findByText(/1\.0\.0/)

        await user.click(screen.getByRole('button', { name: /check for updates/i }))

        expect(mockCheckForDesktopUpdate).toHaveBeenCalledTimes(1)
        expect(await screen.findByText(/latest version \(1\.0\.0\)/i)).toBeInTheDocument()
    })

    it('surfaces an available update and installs it on demand', async () => {
        mockCheckForDesktopUpdate.mockResolvedValue({ available: true, version: '1.1.0' })
        const user = userEvent.setup()
        render(<DesktopUpdateSettings />)
        await screen.findByText(/1\.0\.0/)

        await user.click(screen.getByRole('button', { name: /check for updates/i }))

        expect(await screen.findByText(/1\.1\.0 is available/i)).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /install & restart/i }))
        await waitFor(() => expect(mockInstallPendingUpdate).toHaveBeenCalledTimes(1))
    })

    it('shows an error message when the check fails', async () => {
        mockCheckForDesktopUpdate.mockRejectedValue(new Error('network down'))
        const user = userEvent.setup()
        render(<DesktopUpdateSettings />)
        await screen.findByText(/1\.0\.0/)

        await user.click(screen.getByRole('button', { name: /check for updates/i }))

        expect(await screen.findByText(/couldn't check for updates/i)).toBeInTheDocument()
    })
})
