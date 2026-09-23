import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderWithProviders, screen } from '@/test/test-utils'
import Landing from '../LandingPage'

describe('Landing page', () => {
    it('links to the desktop download page from the nav', () => {
        renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

        const navLinks = screen.getAllByRole('link', { name: /download/i })
        expect(navLinks.some((link) => link.getAttribute('href') === '/download')).toBe(true)
    })

    it('links to the desktop download page from the hero', () => {
        renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

        expect(screen.getByText(/prefer an installed app/i)).toBeInTheDocument()
        const heroLink = screen.getByRole('link', { name: /get the desktop app/i })
        expect(heroLink).toHaveAttribute('href', '/download')
    })

    it('links to the desktop download page from the footer', () => {
        renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

        const downloadLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/download')
        expect(downloadLinks.length).toBeGreaterThanOrEqual(3)
    })

    it('has a pricing teaser section linking to /pricing', () => {
        renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

        const pricingLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/pricing')
        expect(pricingLinks.length).toBeGreaterThanOrEqual(1)
    })

    describe('"View demo" entry point (M9)', () => {
        afterEach(() => {
            vi.unstubAllEnvs()
        })

        it('is hidden when no demo account is configured (the self-hosted default)', () => {
            vi.stubEnv('VITE_DEMO_EMAIL', '')
            vi.stubEnv('VITE_DEMO_PASSWORD', '')

            renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

            expect(screen.queryByRole('link', { name: /view the demo/i })).not.toBeInTheDocument()
        })

        it('links to /login?demo=1 when a demo account is configured', () => {
            vi.stubEnv('VITE_DEMO_EMAIL', 'demo@corvale.app')
            vi.stubEnv('VITE_DEMO_PASSWORD', 'CorvaleDemo!2026')

            renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

            expect(screen.getByRole('link', { name: /view the demo/i })).toHaveAttribute('href', '/login?demo=1')
        })
    })
})
