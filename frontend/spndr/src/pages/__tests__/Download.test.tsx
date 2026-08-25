import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen } from '../../test/test-utils'
import Download from '../Download'

vi.mock('../../utils/platformDetect', () => ({
    detectPlatform: vi.fn(),
}))

import { detectPlatform } from '../../utils/platformDetect'

describe('Download page', () => {
    beforeEach(() => {
        vi.mocked(detectPlatform).mockReturnValue('windows')
    })

    it('renders a card for every supported desktop platform', () => {
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        expect(screen.getByRole('heading', { name: /windows/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /macos/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /linux/i })).toBeInTheDocument()
    })

    it('flags the platform detected from the browser as recommended', () => {
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        expect(screen.getByText(/recommended for your device/i)).toBeInTheDocument()
    })

    it('recommends nothing when the platform cannot be detected', () => {
        vi.mocked(detectPlatform).mockReturnValue('unknown')
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        expect(screen.queryByText(/recommended for your device/i)).not.toBeInTheDocument()
    })

    it('shows a coming-soon state instead of a dead download link before any build is signed and published', () => {
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThan(0)
        expect(screen.queryByRole('link', { name: /^download for/i })).not.toBeInTheDocument()
    })

    it('lists system requirements for each platform', () => {
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        expect(screen.getByText(/webview2/i)).toBeInTheDocument()
        expect(screen.getByText(/monterey/i)).toBeInTheDocument()
        expect(screen.getByText(/webkit2gtk/i)).toBeInTheDocument()
    })

    it('links back to the desktop app documentation', () => {
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        const docsLink = screen.getByRole('link', { name: /desktop app docs/i })
        expect(docsLink).toHaveAttribute('href', expect.stringContaining('/desktop/overview'))
    })
})
