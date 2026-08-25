import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen } from '../../test/test-utils'
import Download from '../Download'
import type { ReleaseManifest } from '../../data/releaseManifest'

vi.mock('../../utils/platformDetect', () => ({
    detectPlatform: vi.fn(),
}))

vi.mock('../../data/releaseManifest', () => ({
    getReleaseManifest: vi.fn(),
}))

import { detectPlatform } from '../../utils/platformDetect'
import { getReleaseManifest } from '../../data/releaseManifest'

const asset = (label: string, url: string | null, sha256: string | null, sizeBytes: number | null) => ({
    label,
    url,
    sha256,
    sizeBytes,
})

const availableManifest: ReleaseManifest = {
    version: '0.17.0',
    publishedAt: '2026-08-25T20:31:20Z',
    available: true,
    releaseNotesUrl: 'https://github.com/RRI-Atharv37/spndr/releases/tag/v0.17.0',
    highlights: [
        'Native SQLite storage, encrypted at rest with SQLCipher',
        'Sign in once, then use spndr fully offline',
        'Automatic updates, verified against a signed release before install',
    ],
    platforms: [
        {
            id: 'windows',
            label: 'Windows',
            fileLabel: '.msi installer',
            systemRequirements: ['Windows 10 or later (64-bit)', 'WebView2 runtime'],
            primary: asset('.msi installer', 'https://example.com/spndr_x64_en-US.msi', 'aaa111', 7827456),
            alternates: [asset('.exe installer', 'https://example.com/spndr_x64-setup.exe', 'bbb222', 5811999)],
        },
        {
            id: 'macos',
            label: 'macOS',
            fileLabel: '.dmg disk image (Apple Silicon)',
            systemRequirements: ['macOS 12 Monterey or later', 'Apple Silicon or Intel'],
            primary: asset('Apple Silicon (.dmg)', 'https://example.com/spndr_aarch64.dmg', 'ccc333', 8088151),
            alternates: [asset('Intel (.dmg)', 'https://example.com/spndr_x64.dmg', 'ddd444', 8190126)],
        },
        {
            id: 'linux',
            label: 'Linux',
            fileLabel: '.deb package',
            systemRequirements: ['webkit2gtk 4.1 and libayatana-appindicator3'],
            primary: asset('.deb package', 'https://example.com/spndr_amd64.deb', 'eee555', 8467760),
            alternates: [
                asset('.rpm package', 'https://example.com/spndr.x86_64.rpm', 'fff666', 8467532),
                asset('.AppImage', 'https://example.com/spndr_amd64.AppImage', 'ggg777', 85588472),
            ],
        },
    ],
}

const unavailableManifest: ReleaseManifest = {
    ...availableManifest,
    available: false,
    platforms: availableManifest.platforms.map((platform) => ({
        ...platform,
        primary: { ...platform.primary, url: null, sha256: null, sizeBytes: null },
        alternates: platform.alternates.map((alt) => ({ ...alt, url: null, sha256: null, sizeBytes: null })),
    })),
}

describe('Download page', () => {
    beforeEach(() => {
        vi.mocked(detectPlatform).mockReturnValue('windows')
        vi.mocked(getReleaseManifest).mockReturnValue(availableManifest)
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
        vi.mocked(getReleaseManifest).mockReturnValue(unavailableManifest)
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThan(0)
        expect(screen.queryByRole('link', { name: /^download for/i })).not.toBeInTheDocument()
    })

    it('renders the primary download link, checksum, and size once a build is published', () => {
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        const windowsLink = screen.getByRole('link', { name: /download for windows/i })
        expect(windowsLink).toHaveAttribute('href', 'https://example.com/spndr_x64_en-US.msi')
        expect(screen.getByText(/aaa111/)).toBeInTheDocument()
        expect(screen.getByText(/7\.5\s?MB/i)).toBeInTheDocument()
    })

    it('keeps alternate formats collapsed until "see all formats" is toggled', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        expect(screen.queryByText(/\.exe installer/i)).not.toBeInTheDocument()

        const toggles = screen.getAllByRole('button', { name: /see all formats/i })
        expect(toggles).toHaveLength(3)
        await user.click(toggles[0])

        expect(screen.getByText(/\.exe installer/i)).toBeInTheDocument()
        const exeLink = screen.getByRole('link', { name: /\.exe installer/i })
        expect(exeLink).toHaveAttribute('href', 'https://example.com/spndr_x64-setup.exe')
        expect(screen.getByText(/bbb222/)).toBeInTheDocument()
    })

    it('lists every alternate format for platforms with more than one, e.g. Linux', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Download />, { withUser: false, withWorkspace: false })

        const toggles = screen.getAllByRole('button', { name: /see all formats/i })
        await user.click(toggles[2])

        expect(screen.getByText(/\.rpm package/i)).toBeInTheDocument()
        expect(screen.getByText(/\.AppImage/i)).toBeInTheDocument()
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
